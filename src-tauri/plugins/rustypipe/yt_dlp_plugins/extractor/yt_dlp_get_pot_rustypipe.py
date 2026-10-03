from __future__ import annotations

import os.path
import subprocess
import functools
from typing import Optional
from datetime import datetime, timedelta
from itertools import takewhile

from yt_dlp.utils import Popen, try_get

from yt_dlp.extractor.youtube.pot.provider import (
    PoTokenProvider,
    PoTokenContext,
    PoTokenRequest,
    PoTokenResponse,
    ExternalRequestFeature,
    PoTokenProviderRejectedRequest,
    PoTokenProviderError,
    register_preference,
    register_provider,
)
from yt_dlp.extractor.youtube.pot.utils import WEBPO_CLIENTS, get_webpo_content_binding

__version__ = "0.2.0"


@register_provider
class RustyPipeBotguardPTP(PoTokenProvider):
    _REPO_URL = "https://codeberg.org/ThetaDev/rustypipe-botguard"

    PROVIDER_NAME = "rustypipe-botguard"
    PROVIDER_VERSION = __version__
    BUG_REPORT_LOCATION = _REPO_URL + "/issues"

    _SUPPORTED_CLIENTS = WEBPO_CLIENTS
    _SUPPORTED_CONTEXTS = (
        PoTokenContext.GVS,
        PoTokenContext.PLAYER,
        PoTokenContext.SUBS,
    )
    _SUPPORTED_PROXY_SCHEMES = (
        "http",
        "https",
    )
    _SUPPORTED_EXTERNAL_REQUEST_FEATURES = (
        ExternalRequestFeature.PROXY_SCHEME_HTTP,
        ExternalRequestFeature.PROXY_SCHEME_HTTPS,
    )
    _BOTGUARD_BIN = "rustypipe-botguard"
    _BOTGUARD_VERSION = "1"
    _CFG_PREFIX = "rustypipe_bg_"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @classmethod
    def __check_bin(cls, bin_path: str) -> bool:
        try:
            stdout, _, returncode = Popen.run(
                [bin_path, "--version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=1.0,
            )
            if returncode == 0:
                vc = "rustypipe-botguard-api "
                pos = stdout.find(vc) + len(vc)
                version = "".join(takewhile(str.isnumeric, stdout[pos:]))
                if version == cls._BOTGUARD_VERSION:
                    return True
        except Exception:
            pass
        return False

    @functools.cached_property
    def __bin_path(self) -> Optional[str]:
        cfg_bin_path = try_get(
            self._configuration_arg(self._CFG_PREFIX + "bin", casesense=True),
            lambda x: x[0],
        )
        if cfg_bin_path:
            if self.__check_bin(cfg_bin_path):
                return cfg_bin_path
            else:
                msg = f"No valid {self._BOTGUARD_BIN} v{self._BOTGUARD_VERSION} binary found at the configured path"
                self.logger.error(msg)
                raise PoTokenProviderError(msg)

        # Locate the rustypipe-botguard binary
        for bin_path in [self._BOTGUARD_BIN, "./" + self._BOTGUARD_BIN]:
            if self.__check_bin(bin_path):
                return bin_path

        self.logger.info(
            f"No valid {self._BOTGUARD_BIN} v{self._BOTGUARD_VERSION} binary found. Download from {self._REPO_URL}/releases"
        )
        return None

    def is_available(self):
        return self.__bin_path is not None

    def _real_request_pot(self, request: PoTokenRequest) -> PoTokenResponse:  #
        ident, _ = get_webpo_content_binding(request)
        if not ident:
            raise PoTokenProviderRejectedRequest("no content binding")

        self.logger.trace(f"Generating POT using {self.__bin_path}; ident={ident}")

        snapshot_file = self._configuration_arg(
            self._CFG_PREFIX + "snapshot_file", [None], casesense=True
        )[0]
        no_snapshot = self.__get_bool(
            self._configuration_arg(self._CFG_PREFIX + "no_snapshot", casesense=True)
        )
        user_agent = self._configuration_arg(
            self._CFG_PREFIX + "user_agent", [None], casesense=True
        )[0]

        command_args = [self.__bin_path]
        env = os.environ

        if no_snapshot:
            command_args.append("--no-snapshot")
        elif snapshot_file:
            command_args.extend(["--snapshot-file", snapshot_file])
        if user_agent:
            command_args.extend(["--user-agent", user_agent])

        command_args.extend(["--", ident])

        if proxy := request.request_proxy:
            env["ALL_PROXY"] = proxy

        try:
            stdout, stderr, returncode = Popen.run(
                command_args,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=20.0,
            )
        except subprocess.TimeoutExpired as e:
            raise PoTokenProviderError(
                f"rustypipe-botguard failed: Timeout expired when trying to run script (caused by {e!r})"
            )
        except Exception as e:
            raise PoTokenProviderError(
                f"rustypipe-botguard failed: Unable to run script (caused by {e!r})"
            ) from e

        stdout = stdout.strip()
        if returncode:
            raise PoTokenProviderError(
                f"rustypipe-botguard failed with returncode {returncode}; output:\n{stderr.strip()}"
            )

        parts = stdout.split()
        if not parts:
            raise PoTokenProviderError(
                "rustypipe-botguard did not respond with a po_token"
            )

        metadata = {}
        for p in parts[1:]:
            try:
                [k, v] = p.split("=", 1)
                metadata[k] = v
            except ValueError:
                pass

        po_token = parts[0]
        expires_at = None
        valid_for = timedelta(hours=12)
        if ts := metadata.get("valid_until"):
            expires_at = int(ts)
            valid_for = datetime.fromtimestamp(expires_at) - datetime.now()
        from_snapshot = self.__parse_bool(metadata.get("from_snapshot"))

        self.logger.info(
            f"Generated {request.context.value} POT (valid for {self.__fmt_timedelta(valid_for)}, from_snapshot={from_snapshot})"
        )

        return PoTokenResponse(po_token=po_token, expires_at=expires_at)

    @staticmethod
    def __parse_bool(x) -> bool:
        if isinstance(x, str):
            return x.lower() in ("yes", "true", "1")
        return bool(x)

    @staticmethod
    def __get_bool(x, default=False) -> bool:
        res = try_get(
            x,
            lambda x: x[0].lower() in ("yes", "true", "1"),
        )
        if res is None:
            return default
        return res

    @staticmethod
    def __fmt_timedelta(td: timedelta) -> str:
        total_seconds = int(td.total_seconds())
        hours, remainder = divmod(total_seconds, 60 * 60)
        minutes, _ = divmod(remainder, 60)
        return f"{hours}h {minutes}m"


@register_preference(RustyPipeBotguardPTP)
def rustypipe_botguard_getpot_preference(
    provider: PoTokenProvider, request: PoTokenRequest
) -> int:
    return 120
