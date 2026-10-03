//! Minimal RFC 6455 WebSocket client, used only to speak the Chromium
//! DevTools Protocol to a loopback capture browser.
//!
//! Deliberately dependency-free (the repository must not gain a new network
//! stack for Phase 1). Only the subset CDP needs is implemented:
//! client-masked text frames, ping/pong, close and fragmented messages.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const OPCODE_CONTINUATION: u8 = 0x0;
const OPCODE_TEXT: u8 = 0x1;
const OPCODE_BINARY: u8 = 0x2;
const OPCODE_CLOSE: u8 = 0x8;
const OPCODE_PING: u8 = 0x9;
const OPCODE_PONG: u8 = 0xA;

/// Upper bound for a single reassembled CDP message. Network responses with
/// large header sets are still far below this; anything larger is a protocol
/// error and would otherwise be unbounded memory.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WsMessage {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WsError {
    Io(String),
    Protocol(String),
}

impl std::fmt::Display for WsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WsError::Io(message) => write!(formatter, "websocket io error: {message}"),
            WsError::Protocol(message) => write!(formatter, "websocket protocol error: {message}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub fin: bool,
    pub opcode: u8,
    pub masked: bool,
    pub payload_len: u64,
    pub header_len: usize,
}

/// Parse one frame header from `buffer`. Returns `None` when more bytes are
/// required.
pub fn parse_frame_header(buffer: &[u8]) -> Result<Option<FrameHeader>, WsError> {
    if buffer.len() < 2 {
        return Ok(None);
    }

    let fin = buffer[0] & 0x80 != 0;
    let opcode = buffer[0] & 0x0F;
    let masked = buffer[1] & 0x80 != 0;
    let short_len = (buffer[1] & 0x7F) as usize;

    let (payload_len, mut offset) = match short_len {
        126 => {
            if buffer.len() < 4 {
                return Ok(None);
            }
            (u16::from_be_bytes([buffer[2], buffer[3]]) as u64, 4)
        }
        127 => {
            if buffer.len() < 10 {
                return Ok(None);
            }
            let mut value: u64 = 0;
            for byte in &buffer[2..10] {
                value = (value << 8) | u64::from(*byte);
            }
            (value, 10)
        }
        value => (value as u64, 2),
    };

    if payload_len > MAX_MESSAGE_BYTES as u64 {
        return Err(WsError::Protocol(format!(
            "frame payload of {payload_len} bytes exceeds the message limit"
        )));
    }

    if masked {
        offset += 4;
        if buffer.len() < offset {
            return Ok(None);
        }
    }

    Ok(Some(FrameHeader {
        fin,
        opcode,
        masked,
        payload_len,
        header_len: offset,
    }))
}

/// Encode a client frame. Client frames are always masked, as required by
/// RFC 6455 section 5.3.
pub fn encode_client_frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | opcode);

    let len = payload.len();
    if len < 126 {
        frame.push(0x80 | len as u8);
    } else if len <= u16::MAX as usize {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }

    frame.extend_from_slice(&mask);
    for (index, byte) in payload.iter().enumerate() {
        frame.push(byte ^ mask[index % 4]);
    }
    frame
}

pub fn apply_mask(payload: &mut [u8], mask: [u8; 4]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index % 4];
    }
}

pub struct WsClient {
    stream: TcpStream,
    read_buffer: Vec<u8>,
    closed: bool,
}

impl WsClient {
    /// Perform the client handshake against `127.0.0.1:port` and return a
    /// connected client.
    pub async fn connect(port: u16, path: &str, timeout: Duration) -> Result<WsClient, WsError> {
        let connect = TcpStream::connect(("127.0.0.1", port));
        let mut stream = match tokio::time::timeout(timeout, connect).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(error)) => return Err(WsError::Io(error.to_string())),
            Err(_) => return Err(WsError::Io("websocket connect timed out".to_string())),
        };
        let _ = stream.set_nodelay(true);

        let key = client_key();
        let request = format!(
            "GET {path} HTTP/1.1\r\n\
             Host: 127.0.0.1:{port}\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: {key}\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|error| WsError::Io(error.to_string()))?;

        let mut head = Vec::with_capacity(256);
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if head.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
            if tokio::time::Instant::now() > deadline {
                return Err(WsError::Io("websocket handshake timed out".to_string()));
            }
            let mut chunk = [0u8; 128];
            let read = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut chunk))
                .await
                .map_err(|_| WsError::Io("websocket handshake read timed out".to_string()))?
                .map_err(|error| WsError::Io(error.to_string()))?;
            if read == 0 {
                return Err(WsError::Protocol(
                    "connection closed during handshake".to_string(),
                ));
            }
            head.extend_from_slice(&chunk[..read]);
            if head.len() > 16 * 1024 {
                return Err(WsError::Protocol(
                    "handshake response too large".to_string(),
                ));
            }
        }

        let head_text = String::from_utf8_lossy(&head).to_string();
        if !head_text.starts_with("HTTP/1.1 101") {
            let status = head_text.lines().next().unwrap_or("").to_string();
            return Err(WsError::Protocol(format!(
                "unexpected handshake response: {status}"
            )));
        }

        let consumed = head
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|position| position + 4)
            .unwrap_or(head.len());

        Ok(WsClient {
            stream,
            read_buffer: head[consumed..].to_vec(),
            closed: false,
        })
    }

    pub async fn send_text(&mut self, text: &str) -> Result<(), WsError> {
        let mask = mask_key();
        let frame = encode_client_frame(OPCODE_TEXT, text.as_bytes(), mask);
        self.stream
            .write_all(&frame)
            .await
            .map_err(|error| WsError::Io(error.to_string()))
    }

    /// Read the next complete data message. `Ok(None)` means the peer closed the
    /// connection.
    pub async fn next_message(&mut self) -> Result<Option<WsMessage>, WsError> {
        if self.closed {
            return Ok(None);
        }

        let mut assembled: Vec<u8> = Vec::new();
        let mut assembled_opcode: Option<u8> = None;

        loop {
            let header = loop {
                if let Some(header) = parse_frame_header(&self.read_buffer)? {
                    break header;
                }
                if !self.fill_buffer().await? {
                    return Ok(None);
                }
            };

            while self.read_buffer.len() < header.header_len + header.payload_len as usize {
                if !self.fill_buffer().await? {
                    return Ok(None);
                }
            }

            let mut payload = self.read_buffer
                [header.header_len..header.header_len + header.payload_len as usize]
                .to_vec();
            self.read_buffer
                .drain(..header.header_len + header.payload_len as usize);

            if header.masked {
                if payload.len() < 4 {
                    return Err(WsError::Protocol(
                        "masked frame without a mask key".to_string(),
                    ));
                }
                let mut mask = [0u8; 4];
                mask.copy_from_slice(&payload[..4]);
                payload.drain(..4);
                apply_mask(&mut payload, mask);
            }

            match header.opcode {
                OPCODE_PING => {
                    let mask = mask_key();
                    let frame = encode_client_frame(OPCODE_PONG, &payload, mask);
                    self.stream
                        .write_all(&frame)
                        .await
                        .map_err(|error| WsError::Io(error.to_string()))?;
                    continue;
                }
                OPCODE_PONG => continue,
                OPCODE_CLOSE => {
                    self.closed = true;
                    return Ok(None);
                }
                OPCODE_TEXT | OPCODE_BINARY => {
                    if !header.fin {
                        assembled_opcode = Some(header.opcode);
                        assembled.extend_from_slice(&payload);
                        continue;
                    }
                    if assembled.is_empty() {
                        return Ok(Some(self.to_message(header.opcode, payload)?));
                    }
                    assembled.extend_from_slice(&payload);
                    return Ok(Some(self.to_message(
                        assembled_opcode.unwrap_or(header.opcode),
                        assembled,
                    )?));
                }
                OPCODE_CONTINUATION => {
                    assembled.extend_from_slice(&payload);
                    if assembled.len() > MAX_MESSAGE_BYTES {
                        return Err(WsError::Protocol(
                            "fragmented message exceeds the message limit".to_string(),
                        ));
                    }
                    if header.fin {
                        let opcode = assembled_opcode.take().unwrap_or(OPCODE_TEXT);
                        let payload = std::mem::take(&mut assembled);
                        return Ok(Some(self.to_message(opcode, payload)?));
                    }
                    continue;
                }
                other => {
                    return Err(WsError::Protocol(format!("unsupported opcode {other}")));
                }
            }
        }
    }

    fn to_message(&self, opcode: u8, payload: Vec<u8>) -> Result<WsMessage, WsError> {
        match opcode {
            OPCODE_TEXT => String::from_utf8(payload)
                .map(WsMessage::Text)
                .map_err(|_| WsError::Protocol("text frame was not valid UTF-8".to_string())),
            OPCODE_BINARY => Ok(WsMessage::Binary(payload)),
            other => Err(WsError::Protocol(format!("unsupported opcode {other}"))),
        }
    }

    async fn fill_buffer(&mut self) -> Result<bool, WsError> {
        let mut chunk = [0u8; 16 * 1024];
        let read = self
            .stream
            .read(&mut chunk)
            .await
            .map_err(|error| WsError::Io(error.to_string()))?;
        if read == 0 {
            self.closed = true;
            return Ok(false);
        }
        self.read_buffer.extend_from_slice(&chunk[..read]);
        Ok(true)
    }
}

fn mask_key() -> [u8; 4] {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    [bytes[0], bytes[1], bytes[2], bytes[3]]
}

fn client_key() -> String {
    base64_encode(&uuid::Uuid::new_v4().into_bytes())
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        output.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        output.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_small_masked_text_frame() {
        let frame = encode_client_frame(OPCODE_TEXT, b"hi", [1, 2, 3, 4]);
        assert_eq!(frame[0], 0x81);
        assert_eq!(frame[1], 0x82);
        assert_eq!(&frame[2..6], &[1, 2, 3, 4]);
        assert_eq!(&frame[6..8], &[b'h' ^ 1, b'i' ^ 2]);
        assert_eq!(frame.len(), 8);
    }

    #[test]
    fn encodes_extended_payload_lengths() {
        let payload = vec![7u8; 200];
        let frame = encode_client_frame(OPCODE_TEXT, &payload, [0, 0, 0, 0]);
        assert_eq!(frame[1] & 0x7F, 126);
        assert_eq!(u16::from_be_bytes([frame[2], frame[3]]), 200);

        let payload = vec![9u8; 70_000];
        let frame = encode_client_frame(OPCODE_TEXT, &payload, [0, 0, 0, 0]);
        assert_eq!(frame[1] & 0x7F, 127);
        assert_eq!(frame.len(), 2 + 8 + 4 + 70_000);
    }

    #[test]
    fn parses_unmasked_server_frames_incrementally() {
        assert_eq!(
            parse_frame_header(&[]).expect("empty buffer is not an error"),
            None
        );
        assert_eq!(parse_frame_header(&[0x81]).expect("partial header"), None);

        let mut frame = vec![0x81, 5];
        frame.extend_from_slice(b"hello");
        let header = parse_frame_header(&frame)
            .expect("valid header")
            .expect("complete header");
        assert_eq!(header.header_len, 2);
        assert_eq!(header.payload_len, 5);
        assert!(!header.masked);
        assert!(header.fin);
        assert_eq!(header.opcode, OPCODE_TEXT);

        let mut masked = vec![0x81, 0x80 | 3, 9, 9, 9, 9];
        masked.extend_from_slice(&[1, 2, 3]);
        let header = parse_frame_header(&masked)
            .expect("valid masked header")
            .expect("complete masked header");
        assert_eq!(header.header_len, 6);
        assert!(header.masked);
    }

    #[test]
    fn rejects_oversized_frames() {
        let mut frame = vec![0x81, 127];
        frame.extend_from_slice(&(u64::MAX).to_be_bytes());
        assert!(matches!(
            parse_frame_header(&frame),
            Err(WsError::Protocol(_))
        ));
    }

    #[test]
    fn applies_the_mask_symmetrically() {
        let mut payload = *b"payload";
        let original = payload;
        apply_mask(&mut payload, [9, 8, 7, 6]);
        assert_ne!(payload, original);
        apply_mask(&mut payload, [9, 8, 7, 6]);
        assert_eq!(payload, original);
    }

    #[test]
    fn base64_matches_the_known_encoding_of_16_bytes() {
        let encoded = base64_encode(&[
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D,
            0x0E, 0x0F,
        ]);
        assert_eq!(encoded, "AAECAwQFBgcICQoLDA0ODw==");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }

    #[test]
    fn generated_client_keys_are_24_char_base64_strings() {
        let key = client_key();
        assert_eq!(key.len(), 24);
        assert!(key.ends_with("=="));
    }
}
