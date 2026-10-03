//! Loopback-only SOCKS5h egress guard for captured yt-dlp execution.

use super::policy::{check_destination_textual, check_resolved_ip};
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

const SOCKS_VERSION: u8 = 0x05;
const METHOD_NO_AUTH: u8 = 0x00;
const METHOD_NOT_ACCEPTABLE: u8 = 0xff;
const CMD_CONNECT: u8 = 0x01;
const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;
const REPLY_SUCCEEDED: u8 = 0x00;
const REPLY_NOT_ALLOWED: u8 = 0x02;
const REPLY_COMMAND_UNSUPPORTED: u8 = 0x07;
const REPLY_ADDRESS_UNSUPPORTED: u8 = 0x08;

#[cfg(test)]
const HANDSHAKE_TIMEOUT: Duration = Duration::from_millis(100);
#[cfg(not(test))]
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const DNS_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(test)]
const MAX_CONCURRENT_CONNECTIONS: usize = 2;
#[cfg(not(test))]
const MAX_CONCURRENT_CONNECTIONS: usize = 16;

/// One in-process, loopback-only SOCKS5 egress guard.
///
/// The public interface is deliberately small: callers only receive the proxy
/// URL and keep the lease alive for the yt-dlp invocation.
pub struct CaptureEgressGuard {
    local_addr: SocketAddr,
    shutdown_tx: watch::Sender<bool>,
    accept_task: JoinHandle<()>,
}

impl CaptureEgressGuard {
    pub async fn start() -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let local_addr = listener.local_addr()?;
        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
        let connection_shutdown_tx = shutdown_tx.clone();
        let connection_limit = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));

        let accept_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        let Ok((stream, _peer)) = accepted else {
                            break;
                        };
                        let Ok(permit) = connection_limit.clone().try_acquire_owned() else {
                            drop(stream);
                            continue;
                        };
                        let mut connection_shutdown = connection_shutdown_tx.subscribe();
                        tokio::spawn(async move {
                            let _permit = permit;
                            tokio::select! {
                                _ = connection_shutdown.changed() => {}
                                _ = handle_client(stream) => {}
                            }
                        });
                    }
                }
            }
        });

        Ok(Self {
            local_addr,
            shutdown_tx,
            accept_task,
        })
    }

    pub fn proxy_url(&self) -> String {
        format!("socks5h://{}", self.local_addr)
    }

    #[cfg(test)]
    fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }
}

impl Drop for CaptureEgressGuard {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
        self.accept_task.abort();
    }
}

fn validate_resolved_targets(
    host: &str,
    port: u16,
    resolved: Vec<SocketAddr>,
) -> io::Result<SocketAddr> {
    let textual = format!("https://{host}/");
    check_destination_textual(&textual).map_err(|reject| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("capture-destination-rejected: {}", reject.code()),
        )
    })?;

    if resolved.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "capture-destination-rejected: dns-unresolved",
        ));
    }

    for address in &resolved {
        check_resolved_ip(address.ip()).map_err(|reject| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("capture-destination-rejected: {}", reject.code()),
            )
        })?;
    }

    let mut selected = resolved[0];
    selected.set_port(port);
    Ok(selected)
}

async fn handle_client(mut client: TcpStream) -> io::Result<()> {
    let upstream = match timeout(HANDSHAKE_TIMEOUT, negotiate(&mut client)).await {
        Ok(result) => result?,
        Err(_) => return Ok(()),
    };

    let Some(mut upstream) = upstream else {
        return Ok(());
    };
    let _ = relay_opaque(&mut client, &mut upstream).await;
    Ok(())
}

async fn relay_opaque<A, B>(client: &mut A, upstream: &mut B) -> io::Result<()>
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    tokio::io::copy_bidirectional(client, upstream)
        .await
        .map(|_| ())
}

async fn negotiate(client: &mut TcpStream) -> io::Result<Option<TcpStream>> {
    let version = client.read_u8().await?;
    let method_count = client.read_u8().await? as usize;
    if version != SOCKS_VERSION || method_count == 0 {
        return Ok(None);
    }

    let mut methods = vec![0u8; method_count];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&METHOD_NO_AUTH) {
        client
            .write_all(&[SOCKS_VERSION, METHOD_NOT_ACCEPTABLE])
            .await?;
        return Ok(None);
    }
    client.write_all(&[SOCKS_VERSION, METHOD_NO_AUTH]).await?;

    let version = client.read_u8().await?;
    let command = client.read_u8().await?;
    let reserved = client.read_u8().await?;
    let address_type = client.read_u8().await?;

    if version != SOCKS_VERSION || reserved != 0 {
        return Ok(None);
    }
    if command != CMD_CONNECT {
        discard_request_address(client, address_type).await?;
        write_reply(client, REPLY_COMMAND_UNSUPPORTED).await?;
        return Ok(None);
    }

    let target = match address_type {
        ATYP_IPV4 => {
            let mut octets = [0u8; 4];
            client.read_exact(&mut octets).await?;
            let port = client.read_u16().await?;
            let ip = IpAddr::V4(Ipv4Addr::from(octets));
            if check_resolved_ip(ip).is_err() {
                write_reply(client, REPLY_NOT_ALLOWED).await?;
                return Ok(None);
            }
            SocketAddr::new(ip, port)
        }
        ATYP_IPV6 => {
            let mut octets = [0u8; 16];
            client.read_exact(&mut octets).await?;
            let port = client.read_u16().await?;
            let ip = IpAddr::V6(Ipv6Addr::from(octets));
            if check_resolved_ip(ip).is_err() {
                write_reply(client, REPLY_NOT_ALLOWED).await?;
                return Ok(None);
            }
            SocketAddr::new(ip, port)
        }
        ATYP_DOMAIN => {
            let length = client.read_u8().await? as usize;
            if length == 0 {
                write_reply(client, REPLY_ADDRESS_UNSUPPORTED).await?;
                return Ok(None);
            }
            let mut host_bytes = vec![0u8; length];
            client.read_exact(&mut host_bytes).await?;
            let port = client.read_u16().await?;
            let Ok(host) = String::from_utf8(host_bytes) else {
                write_reply(client, REPLY_ADDRESS_UNSUPPORTED).await?;
                return Ok(None);
            };
            if !host.is_ascii() {
                write_reply(client, REPLY_ADDRESS_UNSUPPORTED).await?;
                return Ok(None);
            }

            let textual = format!("https://{host}/");
            if check_destination_textual(&textual).is_err() {
                write_reply(client, REPLY_NOT_ALLOWED).await?;
                return Ok(None);
            }

            let resolved = match timeout(DNS_TIMEOUT, lookup_host((host.as_str(), port))).await {
                Ok(Ok(addresses)) => addresses.collect::<Vec<_>>(),
                _ => {
                    write_reply(client, REPLY_NOT_ALLOWED).await?;
                    return Ok(None);
                }
            };
            match validate_resolved_targets(&host, port, resolved) {
                Ok(address) => address,
                Err(_) => {
                    write_reply(client, REPLY_NOT_ALLOWED).await?;
                    return Ok(None);
                }
            }
        }
        _ => {
            write_reply(client, REPLY_ADDRESS_UNSUPPORTED).await?;
            return Ok(None);
        }
    };

    let upstream = match timeout(CONNECT_TIMEOUT, TcpStream::connect(target)).await {
        Ok(Ok(stream)) => stream,
        _ => {
            write_reply(client, REPLY_NOT_ALLOWED).await?;
            return Ok(None);
        }
    };

    write_reply(client, REPLY_SUCCEEDED).await?;
    Ok(Some(upstream))
}

async fn discard_request_address(stream: &mut TcpStream, address_type: u8) -> io::Result<()> {
    match address_type {
        ATYP_IPV4 => {
            let mut remainder = [0u8; 6];
            stream.read_exact(&mut remainder).await?;
        }
        ATYP_IPV6 => {
            let mut remainder = [0u8; 18];
            stream.read_exact(&mut remainder).await?;
        }
        ATYP_DOMAIN => {
            let length = stream.read_u8().await? as usize;
            let mut remainder = vec![0u8; length + 2];
            stream.read_exact(&mut remainder).await?;
        }
        _ => {}
    }
    Ok(())
}
async fn write_reply(stream: &mut TcpStream, code: u8) -> io::Result<()> {
    stream
        .write_all(&[SOCKS_VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    #[test]
    fn mixed_dns_answers_fail_closed_before_any_connect() {
        let public: SocketAddr = "93.184.216.34:443".parse().expect("public fixture");
        let forbidden: SocketAddr = "127.0.0.1:443".parse().expect("loopback fixture");

        let result = validate_resolved_targets("media.example", 443, vec![public, forbidden]);

        assert!(
            result.is_err(),
            "one forbidden answer must reject the entire DNS result set"
        );
    }

    #[test]
    fn allowed_dns_answer_returns_the_exact_validated_socket_address() {
        let expected: SocketAddr = "93.184.216.34:8443".parse().expect("public fixture");
        let result = validate_resolved_targets("media.example", 8443, vec![expected])
            .expect("public answer");

        assert_eq!(result, expected);
    }

    async fn socks5_no_auth(stream: &mut TcpStream) {
        stream
            .write_all(&[0x05, 0x01, 0x00])
            .await
            .expect("write greeting");
        let mut reply = [0u8; 2];
        stream.read_exact(&mut reply).await.expect("read greeting");
        assert_eq!(reply, [0x05, 0x00]);
    }

    #[tokio::test]
    async fn concurrent_connection_limit_rejects_excess_clients() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");

        let mut first = TcpStream::connect(guard.local_addr()).await.expect("first");
        let mut second = TcpStream::connect(guard.local_addr())
            .await
            .expect("second");
        first.write_all(&[0x05]).await.expect("hold first");
        second.write_all(&[0x05]).await.expect("hold second");
        tokio::time::sleep(Duration::from_millis(20)).await;

        let mut excess = TcpStream::connect(guard.local_addr())
            .await
            .expect("excess");
        excess
            .write_all(&[0x05, 0x01, 0x00])
            .await
            .expect("write excess greeting");

        let mut reply = [0u8; 2];
        let result = timeout(Duration::from_millis(50), excess.read(&mut reply)).await;
        assert!(
            matches!(result, Ok(Ok(0)) | Ok(Err(_))),
            "connection above the fixed guard limit must be closed immediately"
        );
    }

    #[tokio::test]
    async fn dropping_guard_closes_an_inflight_handshake_connection() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let mut client = TcpStream::connect(guard.local_addr())
            .await
            .expect("connect guard");
        tokio::time::sleep(Duration::from_millis(25)).await;

        drop(guard);

        let mut byte = [0u8; 1];
        let closed = timeout(Duration::from_millis(300), client.read(&mut byte)).await;
        assert!(
            matches!(closed, Ok(Ok(0)) | Ok(Err(_))),
            "dropping the guard must close already accepted connections"
        );
    }

    #[tokio::test]
    async fn incomplete_handshake_is_closed_by_the_handshake_timeout() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let mut client = TcpStream::connect(guard.local_addr())
            .await
            .expect("connect guard");
        client.write_all(&[0x05]).await.expect("partial greeting");

        let mut byte = [0u8; 1];
        let closed = timeout(Duration::from_millis(500), client.read(&mut byte)).await;
        assert!(
            matches!(closed, Ok(Ok(0)) | Ok(Err(_))),
            "an incomplete handshake must not hold a connection indefinitely"
        );
    }

    #[tokio::test]
    async fn binds_loopback_and_returns_a_socks5h_proxy_url() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let proxy_url = guard.proxy_url();
        let expected_prefix = format!("{}://{}:", "socks5h", "127.0.0.1");
        assert!(proxy_url.starts_with(&expected_prefix));

        let address = guard.local_addr();
        assert!(address.ip().is_loopback());
        TcpStream::connect(address)
            .await
            .expect("loopback listener must accept connections");
    }

    #[tokio::test]
    async fn rejects_loopback_domain_through_destination_policy() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let mut client = TcpStream::connect(guard.local_addr())
            .await
            .expect("connect guard");
        socks5_no_auth(&mut client).await;

        let host = b"localhost";
        let mut request = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
        request.extend_from_slice(host);
        request.extend_from_slice(&443u16.to_be_bytes());
        client
            .write_all(&request)
            .await
            .expect("write domain connect");

        let mut reply = [0u8; 10];
        client
            .read_exact(&mut reply)
            .await
            .expect("read connect reply");
        assert_eq!(reply[1], REPLY_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn rejects_loopback_ipv6_through_destination_policy() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let mut client = TcpStream::connect(guard.local_addr())
            .await
            .expect("connect guard");
        socks5_no_auth(&mut client).await;

        let mut request = vec![0x05, 0x01, 0x00, 0x04];
        request.extend_from_slice(&std::net::Ipv6Addr::LOCALHOST.octets());
        request.extend_from_slice(&443u16.to_be_bytes());
        client
            .write_all(&request)
            .await
            .expect("write ipv6 connect");

        let mut reply = [0u8; 10];
        client
            .read_exact(&mut reply)
            .await
            .expect("read connect reply");
        assert_eq!(reply[1], REPLY_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn rejects_loopback_ipv4_without_connecting_to_the_target() {
        let protected = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("protected listener");
        let protected_addr = protected.local_addr().expect("protected addr");

        let guard = CaptureEgressGuard::start().await.expect("start guard");
        let mut client = TcpStream::connect(guard.local_addr())
            .await
            .expect("connect guard");
        socks5_no_auth(&mut client).await;

        let mut request = vec![0x05, 0x01, 0x00, 0x01];
        request.extend_from_slice(&[127, 0, 0, 1]);
        request.extend_from_slice(&protected_addr.port().to_be_bytes());
        client.write_all(&request).await.expect("write connect");

        let mut reply = [0u8; 10];
        client
            .read_exact(&mut reply)
            .await
            .expect("read connect reply");
        assert_eq!(reply[0], 0x05);
        assert_ne!(reply[1], 0x00, "loopback destination must be rejected");

        assert!(
            timeout(Duration::from_millis(150), protected.accept())
                .await
                .is_err(),
            "guard must not connect to the forbidden target"
        );
    }
    #[tokio::test]
    async fn opaque_relay_preserves_tls_like_bytes_without_inspection() {
        let (mut client_side, mut guard_client) = tokio::io::duplex(1024);
        let (mut guard_upstream, mut server_side) = tokio::io::duplex(1024);

        let relay = tokio::spawn(async move {
            relay_opaque(&mut guard_client, &mut guard_upstream)
                .await
                .expect("opaque relay");
        });

        let client_hello = [0x16, 0x03, 0x03, 0x00, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05];
        client_side
            .write_all(&client_hello)
            .await
            .expect("write TLS-like client bytes");
        let mut observed_client = [0u8; 10];
        server_side
            .read_exact(&mut observed_client)
            .await
            .expect("read TLS-like client bytes");
        assert_eq!(observed_client, client_hello);

        let server_hello = [0x16, 0x03, 0x03, 0x00, 0x03, 0x0b, 0x0c, 0x0d];
        server_side
            .write_all(&server_hello)
            .await
            .expect("write TLS-like server bytes");
        let mut observed_server = [0u8; 8];
        client_side
            .read_exact(&mut observed_server)
            .await
            .expect("read TLS-like server bytes");
        assert_eq!(observed_server, server_hello);

        drop(client_side);
        drop(server_side);
        timeout(Duration::from_millis(500), relay)
            .await
            .expect("relay task must terminate")
            .expect("relay task join");
    }

    #[tokio::test]
    async fn rejects_unsupported_auth_bind_and_udp_associate() {
        let guard = CaptureEgressGuard::start().await.expect("start guard");

        let mut auth = TcpStream::connect(guard.local_addr())
            .await
            .expect("auth client");
        auth.write_all(&[0x05, 0x01, 0x02])
            .await
            .expect("write auth greeting");
        let mut auth_reply = [0u8; 2];
        auth.read_exact(&mut auth_reply)
            .await
            .expect("read auth rejection");
        assert_eq!(auth_reply, [SOCKS_VERSION, METHOD_NOT_ACCEPTABLE]);

        for command in [0x02u8, 0x03u8] {
            let mut client = TcpStream::connect(guard.local_addr())
                .await
                .expect("command client");
            socks5_no_auth(&mut client).await;

            let mut request = vec![SOCKS_VERSION, command, 0x00, ATYP_IPV4];
            request.extend_from_slice(&[93, 184, 216, 34]);
            request.extend_from_slice(&443u16.to_be_bytes());
            client
                .write_all(&request)
                .await
                .expect("write unsupported command");

            let mut reply = [0u8; 10];
            client
                .read_exact(&mut reply)
                .await
                .expect("read command rejection");
            assert_eq!(reply[1], REPLY_COMMAND_UNSUPPORTED);
        }
    }

    async fn accept_socks_spy_connection(stream: &mut TcpStream) -> String {
        let version = stream.read_u8().await.expect("spy greeting version");
        let method_count = stream.read_u8().await.expect("spy method count") as usize;
        assert_eq!(version, SOCKS_VERSION);
        let mut methods = vec![0u8; method_count];
        stream.read_exact(&mut methods).await.expect("spy methods");
        assert!(methods.contains(&METHOD_NO_AUTH));
        stream
            .write_all(&[SOCKS_VERSION, METHOD_NO_AUTH])
            .await
            .expect("spy greeting reply");

        assert_eq!(
            stream.read_u8().await.expect("spy request version"),
            SOCKS_VERSION
        );
        assert_eq!(
            stream.read_u8().await.expect("spy request command"),
            CMD_CONNECT
        );
        assert_eq!(stream.read_u8().await.expect("spy reserved"), 0);
        let atyp = stream.read_u8().await.expect("spy atyp");
        let host = match atyp {
            ATYP_DOMAIN => {
                let len = stream.read_u8().await.expect("spy domain length") as usize;
                let mut bytes = vec![0u8; len];
                stream.read_exact(&mut bytes).await.expect("spy domain");
                String::from_utf8(bytes).expect("ascii domain")
            }
            ATYP_IPV4 => {
                let mut bytes = [0u8; 4];
                stream.read_exact(&mut bytes).await.expect("spy ipv4");
                Ipv4Addr::from(bytes).to_string()
            }
            ATYP_IPV6 => {
                let mut bytes = [0u8; 16];
                stream.read_exact(&mut bytes).await.expect("spy ipv6");
                Ipv6Addr::from(bytes).to_string()
            }
            other => panic!("unexpected SOCKS address type: {other}"),
        };
        let _port = stream.read_u16().await.expect("spy port");
        write_reply(stream, REPLY_SUCCEEDED)
            .await
            .expect("spy connect success");
        host
    }

    #[test]
    #[ignore = "runs the bundled yt-dlp binary through a loopback SOCKS spy"]
    fn bundled_ytdlp_uses_socks5h_for_initial_and_redirected_direct_media_requests() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        use std::sync::{Arc, Mutex};

        let yt_dlp = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/yt-dlp.exe");
        if !yt_dlp.is_file() {
            println!("SKIPPED: bundled yt-dlp binary not present at {yt_dlp:?}");
            return;
        }

        let observed = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_observed = observed.clone();
        let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
        let server = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("SOCKS spy runtime");
            runtime.block_on(async move {
                let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                    .await
                    .expect("SOCKS spy bind");
                port_tx
                    .send(listener.local_addr().expect("SOCKS spy address").port())
                    .expect("send SOCKS spy port");

                for sequence in 0..2 {
                    let (mut stream, _) = timeout(Duration::from_secs(10), listener.accept())
                        .await
                        .expect("yt-dlp must reach the SOCKS spy")
                        .expect("accept SOCKS client");
                    let host = accept_socks_spy_connection(&mut stream).await;
                    server_observed
                        .lock()
                        .expect("SOCKS observations")
                        .push(host);

                    let mut request = vec![0u8; 8192];
                    let read = timeout(Duration::from_secs(10), stream.read(&mut request))
                        .await
                        .expect("HTTP request through SOCKS")
                        .expect("read HTTP request");
                    assert!(read > 0, "yt-dlp must send an HTTP request through SOCKS");

                    if sequence == 0 {
                        stream
                            .write_all(
                                b"HTTP/1.1 302 Found\r\nLocation: http://redirect.invalid/final.mp4\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                            )
                            .await
                            .expect("write redirect");
                    } else {
                        let body = vec![0x2au8; 2048];
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream
                            .write_all(response.as_bytes())
                            .await
                            .expect("write final response");
                        stream.write_all(&body).await.expect("write final body");
                    }
                    stream.flush().await.expect("flush SOCKS spy");
                }
            });
        });

        let proxy_port = port_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("SOCKS spy port");
        let output_dir =
            std::env::temp_dir().join(format!("ytdl-flow-socks-redirect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&output_dir);
        std::fs::create_dir_all(&output_dir).expect("create redirect output dir");
        let output_template = output_dir.join("%(title)s.%(ext)s");
        let raw_url = "http://origin.invalid/start.mp4";
        let descriptor = serde_json::json!({
            "id": "socks-redirect-gate",
            "title": "socks-redirect-gate",
            "ext": "mp4",
            "url": raw_url,
            "protocol": "http"
        })
        .to_string();
        let proxy = format!("socks5h://127.0.0.1:{proxy_port}");
        let args = vec![
            "--ignore-config".to_string(),
            "--no-plugin-dirs".to_string(),
            "--no-js-runtimes".to_string(),
            "--no-playlist".to_string(),
            "--proxy".to_string(),
            proxy,
            "--load-info-json".to_string(),
            "-".to_string(),
            "--no-simulate".to_string(),
            "-o".to_string(),
            output_template.to_string_lossy().to_string(),
        ];
        assert!(
            !args.iter().any(|arg| arg.contains(raw_url)),
            "captured URL must stay out of argv"
        );

        let mut child = Command::new(&yt_dlp)
            .args(&args)
            .env("NO_PROXY", "origin.invalid,redirect.invalid")
            .env("no_proxy", "origin.invalid,redirect.invalid")
            .env("HTTP_PROXY", "")
            .env("http_proxy", "")
            .env("HTTPS_PROXY", "")
            .env("https_proxy", "")
            .env("ALL_PROXY", "")
            .env("all_proxy", "")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn bundled yt-dlp");
        child
            .stdin
            .as_mut()
            .expect("yt-dlp stdin")
            .write_all(format!("{descriptor}\n").as_bytes())
            .expect("write direct descriptor");
        drop(child.stdin.take());

        let output = child.wait_with_output().expect("yt-dlp output");
        server.join().expect("SOCKS spy server");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "yt-dlp direct-media redirect gate must succeed: {stderr}"
        );
        assert_eq!(
            observed.lock().expect("SOCKS observations").as_slice(),
            ["origin.invalid", "redirect.invalid"],
            "both the initial target and redirect target must re-enter SOCKS5h"
        );
        let artifacts = std::fs::read_dir(&output_dir)
            .expect("redirect output dir")
            .filter_map(|entry| entry.ok())
            .collect::<Vec<_>>();
        assert_eq!(artifacts.len(), 1, "one downloaded artifact expected");
        let _ = std::fs::remove_dir_all(&output_dir);
    }

    #[test]
    #[ignore = "runs the bundled yt-dlp binary with an unavailable SOCKS proxy"]
    fn bundled_ytdlp_does_not_fall_back_to_direct_connect_when_socks_guard_is_unavailable() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let yt_dlp = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/yt-dlp.exe");
        if !yt_dlp.is_file() {
            println!("SKIPPED: bundled yt-dlp binary not present at {yt_dlp:?}");
            return;
        }

        let (fixture_port_tx, fixture_port_rx) = std::sync::mpsc::channel::<u16>();
        let (accepted_tx, accepted_rx) = std::sync::mpsc::channel::<bool>();
        let fixture = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("fixture runtime");
            runtime.block_on(async move {
                let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                    .await
                    .expect("fixture bind");
                fixture_port_tx
                    .send(listener.local_addr().expect("fixture address").port())
                    .expect("send fixture port");
                let accepted = timeout(Duration::from_secs(3), listener.accept())
                    .await
                    .is_ok();
                accepted_tx.send(accepted).expect("send accept result");
            });
        });
        let fixture_port = fixture_port_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("fixture port");

        let reserved =
            std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("reserve proxy port");
        let unavailable_proxy_port = reserved.local_addr().expect("reserved proxy addr").port();
        drop(reserved);

        let raw_url = format!("http://127.0.0.1:{fixture_port}/direct-fallback.mp4");
        let descriptor = serde_json::json!({
            "id": "no-direct-fallback",
            "title": "no-direct-fallback",
            "ext": "mp4",
            "url": raw_url,
            "protocol": "http"
        })
        .to_string();
        let args = vec![
            "--ignore-config".to_string(),
            "--no-plugin-dirs".to_string(),
            "--no-js-runtimes".to_string(),
            "--no-playlist".to_string(),
            "--proxy".to_string(),
            format!("socks5h://127.0.0.1:{unavailable_proxy_port}"),
            "--load-info-json".to_string(),
            "-".to_string(),
            "--no-simulate".to_string(),
            "-o".to_string(),
            std::env::temp_dir()
                .join("ytdl-flow-no-fallback-%(title)s.%(ext)s")
                .to_string_lossy()
                .to_string(),
        ];

        let mut child = Command::new(&yt_dlp)
            .args(&args)
            .env("NO_PROXY", "127.0.0.1,localhost")
            .env("no_proxy", "127.0.0.1,localhost")
            .env("HTTP_PROXY", "")
            .env("http_proxy", "")
            .env("HTTPS_PROXY", "")
            .env("https_proxy", "")
            .env("ALL_PROXY", "")
            .env("all_proxy", "")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn bundled yt-dlp");
        child
            .stdin
            .as_mut()
            .expect("yt-dlp stdin")
            .write_all(format!("{descriptor}\n").as_bytes())
            .expect("write direct descriptor");
        drop(child.stdin.take());

        let output = child.wait_with_output().expect("yt-dlp output");
        fixture.join().expect("fixture server");
        let direct_connect = accepted_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("fixture accept result");
        assert!(
            !output.status.success(),
            "yt-dlp must fail closed when the explicit SOCKS guard is unavailable"
        );
        assert!(
            !direct_connect,
            "yt-dlp must not bypass the unavailable SOCKS guard with a direct connection"
        );
    }
}
