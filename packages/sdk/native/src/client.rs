//! The client, as a binding over sdk-core's client protocol.
//!
//! TypeScript connects once and then makes every client call (starting
//! workflows, waiting for their results, queries, updates, events, listing,
//! actors) by handing sdk-core an encoded `orcher.client.v1.ClientCall` and
//! reading back the encoded `ClientAnswer`, with the protobuf-ts code
//! generated from the same protocol. A new client call needs no change here.
//!
//! Failures to connect reject with messages tagged by `error_code`; a refused
//! call is an answer, not a rejection.

use std::sync::Arc;
use std::time::Duration;

use neon::prelude::*;
use neon::types::buffer::TypedArray;

use orcher_sdk_core::client::{ConnectOptions, Connection, ProtocolClient};
use orcher_sdk_core::TlsConfig;

use crate::runtime::Runtime;
use crate::types::{get_optional_bool_property, get_optional_string_property, get_string_property};

/// The client connection JavaScript holds, boxed.
pub struct ClientHandleType {
    client: Arc<ProtocolClient>,
}

impl crate::runtime::IntoJs for ClientHandleType {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.boxed(self).upcast())
    }
}

impl Finalize for ClientHandleType {}

// ============================================================================
// Configuration
// ============================================================================

/// Client configuration read from the JavaScript config object.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ClientConfig {
    pub server_url: String,
    pub namespace: String,
    pub identity: Option<String>,
    /// Sent as `authorization: Bearer <key>` on every request.
    pub api_key: Option<String>,
    pub tls_config: Option<TlsConfig>,
    /// The longest any one call to the engine may take; sdk-core's default
    /// when unset.
    pub timeout: Option<Duration>,
}

impl ClientConfig {
    /// Read the config from a JavaScript object.
    ///
    /// Throws when `serverUrl` or `namespace` is missing, or the `tls` block is invalid.
    pub fn from_js<'a, C: Context<'a>>(cx: &mut C, obj: Handle<JsObject>) -> NeonResult<Self> {
        let server_url = get_string_property(cx, obj, "serverUrl")?;
        let namespace = get_string_property(cx, obj, "namespace")?;
        let identity = get_optional_string_property(cx, obj, "identity")?;
        let api_key = get_optional_string_property(cx, obj, "apiKey")?;
        let tls_config = parse_tls_config(cx, obj)?;
        let timeout_value: Handle<JsValue> = obj.get(cx, "timeout")?;
        let timeout = match timeout_value.downcast::<JsNumber, _>(cx) {
            Ok(ms) => {
                let ms = ms.value(cx);
                if !ms.is_finite() || ms <= 0.0 {
                    return cx.throw_error(crate::error_code::tagged_as(
                        "INVALID_ARGUMENT",
                        format!("{ms}"),
                        "timeout must be a positive number of milliseconds",
                    ));
                }
                Some(Duration::from_millis(ms as u64))
            }
            Err(_) => None,
        };

        Ok(Self {
            server_url,
            namespace,
            identity,
            api_key,
            tls_config,
            timeout,
        })
    }
}

/// Parse the TLS settings from a JavaScript client config object.
///
/// Reads the optional `tls` property, an object with:
/// - `caPath`: path to a CA certificate PEM file. Without it, the server is verified
///   against the system trust store.
/// - `certPath`, `keyPath`: paths to the client certificate and key PEM files, for mTLS.
/// - `rejectUnauthorized`: only `true` is accepted; `false` throws.
///
/// Returns `None` when `tls` is absent, which means plaintext.
fn parse_tls_config<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
) -> NeonResult<Option<TlsConfig>> {
    let tls_value: Handle<JsValue> = obj.get(cx, "tls")?;
    if tls_value.is_a::<JsNull, _>(cx) || tls_value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }

    let tls_obj = tls_value
        .downcast::<JsObject, _>(cx)
        .or_else(|_| cx.throw_error("tls must be an object"))?;

    // Certificate verification cannot be turned off by the underlying transport.
    // Reject the request rather than accepting the option and ignoring it, which
    // would leave the caller believing verification was relaxed.
    if let Some(false) = get_optional_bool_property(cx, tls_obj, "rejectUnauthorized")? {
        return cx.throw_error(
            "tls.rejectUnauthorized: false is not supported — certificate verification \
             cannot be disabled. Supply the server's CA via tls.caPath instead \
             (e.g. for a self-signed development certificate).",
        );
    }

    // A missing caPath means "verify against the system trust store", not "no TLS".
    // Returning None here would be read as no TLS, so a tls block without a caPath (the
    // normal shape for mTLS against a publicly trusted server) would connect in plaintext
    // and send credentials in the clear.
    let ca_path = get_optional_string_property(cx, tls_obj, "caPath")?;
    let ca_cert = ca_path
        .map(|path| {
            std::fs::read(&path)
                .or_else(|e| cx.throw_error(format!("Failed to read CA cert '{}': {}", path, e)))
        })
        .transpose()?;

    let cert_path = get_optional_string_property(cx, tls_obj, "certPath")?;
    let key_path = get_optional_string_property(cx, tls_obj, "keyPath")?;

    let client_cert = cert_path
        .map(|p| {
            std::fs::read(&p)
                .or_else(|e| cx.throw_error(format!("Failed to read client cert '{}': {}", p, e)))
        })
        .transpose()?;

    let client_key = key_path
        .map(|p| {
            std::fs::read(&p)
                .or_else(|e| cx.throw_error(format!("Failed to read client key '{}': {}", p, e)))
        })
        .transpose()?;

    let mut tls = TlsConfig::new();
    tls.ca_cert = ca_cert;
    tls.client_cert = client_cert;
    tls.client_key = client_key;
    Ok(Some(tls))
}

// ============================================================================
// Connect
// ============================================================================

/// `clientConnect(config): Promise<ClientHandle>`
///
/// With a `tls` block the connection is made now, so a certificate the server
/// refuses fails here; without, on the first call. `apiKey`, when given, is
/// sent on every call; `timeout` bounds each call.
pub fn connect(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let config_obj = cx.argument::<JsObject>(0)?;
    let config = ClientConfig::from_js(&mut cx, config_obj)?;

    let mut options = ConnectOptions::new(&config.server_url).with_namespace(&config.namespace);
    if let Some(ref key) = config.api_key {
        options = options.with_api_key(key);
    }
    let has_tls = config.tls_config.is_some();
    if let Some(tls) = config.tls_config {
        options = options.with_tls(tls);
    }
    let timeout = config.timeout;

    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        let connection = if has_tls {
            Connection::connect(options).await
        } else {
            Connection::lazy(options)
        }
        .map_err(|e| crate::error_code::tagged(&e, "Client connection failed"))?;
        let mut client = connection.protocol_client();
        if let Some(timeout) = timeout {
            client = client.with_timeout(timeout);
        }
        Ok(ClientHandleType {
            client: Arc::new(client),
        })
    })
}

/// `clientCall(client, call: Uint8Array): Promise<Buffer>`
///
/// Answers an encoded `ClientCall` with an encoded `ClientAnswer`; a refused
/// call is answered with a `ClientError`, never rejected.
pub fn call(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let client = Arc::clone(&cx.argument::<JsBox<ClientHandleType>>(0)?.client);
    let call = cx.argument::<JsTypedArray<u8>>(1)?.as_slice(&cx).to_vec();
    Runtime::global().execute::<_, _, String>(&mut cx, async move { Ok(client.call(&call).await) })
}

/// `clientClose(client): void`
///
/// Nothing to release: the connection closes when the last handle on it is
/// collected.
pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let _client = cx.argument::<JsBox<ClientHandleType>>(0)?;
    Ok(cx.undefined())
}
