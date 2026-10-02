//! Payload codec bindings: gzip, encryption, and chains of the two.
//!
//! Wraps sdk-core's `GzipPayloadCodec` and `EncryptionPayloadCodec`. The functions take
//! and return raw `Buffer` bytes; the TypeScript wrapper classes maintain the payload's
//! `encoding` metadata.

use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;

use orcher_sdk_core::codec::{EncryptionPayloadCodec, GzipPayloadCodec, PayloadCodec};
use orcher_sdk_core::payload::Payload;

// ---------------------------------------------------------------------------
// Handle types (opaque Rust objects held by JS via JsBox)
// ---------------------------------------------------------------------------

/// A gzip codec held by JavaScript.
pub struct GzipCodecHandle {
    codec: GzipPayloadCodec,
}

impl Finalize for GzipCodecHandle {}

/// An encryption codec held by JavaScript.
pub struct EncryptionCodecHandle {
    codec: EncryptionPayloadCodec,
}

impl Finalize for EncryptionCodecHandle {}

/// One codec in a chain, stored as a spec rather than a built codec.
///
/// Specs are cheap to clone, so adding a codec can return a new chain. Codecs are built
/// from their specs on each encode and decode.
#[derive(Clone)]
enum CodecSpec {
    Gzip(u32),
    Encryption([u8; 32]),
}

impl CodecSpec {
    fn build(&self) -> Box<dyn PayloadCodec> {
        match self {
            CodecSpec::Gzip(level) => {
                Box::new(GzipPayloadCodec::new(flate2::Compression::new(*level)))
            }
            CodecSpec::Encryption(key) => Box::new(EncryptionPayloadCodec::new(key)),
        }
    }
}

/// A codec chain held by JavaScript, applied in insertion order on encode.
pub struct CodecChainHandle {
    specs: Vec<CodecSpec>,
}

impl Finalize for CodecChainHandle {}

// ---------------------------------------------------------------------------
// Helper: encode/decode through a PayloadCodec operating on raw bytes
// ---------------------------------------------------------------------------

/// Create a minimal Payload from raw data bytes (no metadata).
fn payload_from_bytes(data: Vec<u8>) -> Payload {
    Payload::new(data, Default::default())
}

/// Extract data bytes from a JsBuffer argument.
fn extract_buffer<'a>(cx: &mut FunctionContext<'a>, index: usize) -> NeonResult<Vec<u8>> {
    let buf = cx.argument::<JsBuffer>(index)?;
    Ok(buf.as_slice(cx).to_vec())
}

/// Return data bytes as a new JsBuffer.
fn return_buffer<'a, C: Context<'a>>(cx: &mut C, data: &[u8]) -> JsResult<'a, JsBuffer> {
    let mut buf = cx.buffer(data.len())?;
    buf.as_mut_slice(cx).copy_from_slice(data);
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Gzip functions
// ---------------------------------------------------------------------------

/// Create a gzip codec. Args: optional config object `{ level?: number }`.
///
/// `level` is 0-9 and defaults to 6; a level above 9 throws.
pub fn codec_gzip_create(mut cx: FunctionContext) -> JsResult<JsBox<GzipCodecHandle>> {
    let level = if let Ok(config) = cx.argument::<JsObject>(0) {
        let level_val: Handle<JsValue> = config.get(&mut cx, "level")?;
        if level_val.is_a::<JsNumber, _>(&mut cx) {
            let n = level_val
                .downcast_or_throw::<JsNumber, _>(&mut cx)?
                .value(&mut cx) as u32;
            if n > 9 {
                return cx.throw_error("Compression level must be 0-9");
            }
            n
        } else {
            6
        }
    } else {
        6
    };

    let handle = GzipCodecHandle {
        codec: GzipPayloadCodec::new(flate2::Compression::new(level)),
    };
    Ok(cx.boxed(handle))
}

/// Compress bytes. Args: handle, Buffer.
pub fn codec_gzip_encode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<GzipCodecHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    let payload = payload_from_bytes(data);
    let encoded = handle
        .codec
        .encode(&payload)
        .or_else(|e| cx.throw_error(format!("Gzip compression failed: {}", e)))?;

    return_buffer(&mut cx, &encoded.data)
}

/// Decompress bytes. Args: handle, Buffer.
pub fn codec_gzip_decode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<GzipCodecHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    // The codec only decodes a payload whose encoding metadata names it.
    let mut payload = payload_from_bytes(data);
    payload.set_metadata_string("encoding", "binary/gzip");

    let decoded = handle
        .codec
        .decode(&payload)
        .or_else(|e| cx.throw_error(format!("Gzip decompression failed: {}", e)))?;

    return_buffer(&mut cx, &decoded.data)
}

// ---------------------------------------------------------------------------
// Encryption functions
// ---------------------------------------------------------------------------

/// Create an encryption codec. Args: key Buffer (32 bytes); an invalid key throws.
pub fn codec_encryption_create(mut cx: FunctionContext) -> JsResult<JsBox<EncryptionCodecHandle>> {
    let key_data = extract_buffer(&mut cx, 0)?;
    let codec = EncryptionPayloadCodec::from_slice(&key_data)
        .or_else(|e| cx.throw_error(format!("Invalid key: {}", e)))?;

    Ok(cx.boxed(EncryptionCodecHandle { codec }))
}

/// Generate a random 32-byte encryption key. No args.
pub fn codec_encryption_generate_key(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let key = EncryptionPayloadCodec::generate_key();
    return_buffer(&mut cx, &key)
}

/// Encrypt bytes. Args: handle, Buffer.
pub fn codec_encryption_encode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<EncryptionCodecHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    let payload = payload_from_bytes(data);
    let encoded = handle
        .codec
        .encode(&payload)
        .or_else(|e| cx.throw_error(format!("Encryption failed: {}", e)))?;

    return_buffer(&mut cx, &encoded.data)
}

/// Decrypt bytes. Args: handle, Buffer.
pub fn codec_encryption_decode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<EncryptionCodecHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    // The codec only decodes a payload whose encoding metadata names it.
    let mut payload = payload_from_bytes(data);
    payload.set_metadata_string("encoding", "binary/encrypted");

    let decoded = handle
        .codec
        .decode(&payload)
        .or_else(|e| cx.throw_error(format!("Decryption failed: {}", e)))?;

    return_buffer(&mut cx, &decoded.data)
}

// ---------------------------------------------------------------------------
// CodecChain functions
// ---------------------------------------------------------------------------

/// Create an empty CodecChain handle. No args.
pub fn codec_chain_create(mut cx: FunctionContext) -> JsResult<JsBox<CodecChainHandle>> {
    Ok(cx.boxed(CodecChainHandle { specs: Vec::new() }))
}

/// Add gzip to a chain. Args: chain handle, optional level (0-9, default 6).
///
/// Returns a new chain handle and leaves the original unchanged.
pub fn codec_chain_add_gzip(mut cx: FunctionContext) -> JsResult<JsBox<CodecChainHandle>> {
    let handle = cx.argument::<JsBox<CodecChainHandle>>(0)?;
    let level = if let Ok(n) = cx.argument::<JsNumber>(1) {
        let l = n.value(&mut cx) as u32;
        if l > 9 {
            return cx.throw_error("Compression level must be 0-9");
        }
        l
    } else {
        6
    };

    let mut specs = handle.specs.clone();
    specs.push(CodecSpec::Gzip(level));
    Ok(cx.boxed(CodecChainHandle { specs }))
}

/// Add encryption to a chain. Args: chain handle, key Buffer (32 bytes).
///
/// Returns a new chain handle and leaves the original unchanged. A key of any other length
/// throws.
pub fn codec_chain_add_encryption(mut cx: FunctionContext) -> JsResult<JsBox<CodecChainHandle>> {
    let handle = cx.argument::<JsBox<CodecChainHandle>>(0)?;
    let key_data = extract_buffer(&mut cx, 1)?;

    if key_data.len() != 32 {
        return cx.throw_error(format!(
            "Invalid key length: expected 32 bytes, got {}",
            key_data.len()
        ));
    }

    let mut key_array = [0u8; 32];
    key_array.copy_from_slice(&key_data);

    let mut specs = handle.specs.clone();
    specs.push(CodecSpec::Encryption(key_array));
    Ok(cx.boxed(CodecChainHandle { specs }))
}

/// Encode bytes through every codec in the chain, in order. Args: handle, Buffer.
pub fn codec_chain_encode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<CodecChainHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    let mut current = payload_from_bytes(data);
    for spec in &handle.specs {
        let codec = spec.build();
        current = codec
            .encode(&current)
            .or_else(|e| cx.throw_error(format!("Codec chain encode failed: {}", e)))?;
    }

    return_buffer(&mut cx, &current.data)
}

/// Decode bytes through the chain in reverse order. Args: handle, Buffer.
///
/// Each codec's `decode` accepts a payload only when its encoding metadata names that
/// codec, so the matching encoding is set before each step.
pub fn codec_chain_decode(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let handle = cx.argument::<JsBox<CodecChainHandle>>(0)?;
    let data = extract_buffer(&mut cx, 1)?;

    let mut current = payload_from_bytes(data);

    for spec in handle.specs.iter().rev() {
        let codec = spec.build();
        let encoding = match spec {
            CodecSpec::Gzip(_) => "binary/gzip",
            CodecSpec::Encryption(_) => "binary/encrypted",
        };
        current.set_metadata_string("encoding", encoding);
        current = codec
            .decode(&current)
            .or_else(|e| cx.throw_error(format!("Codec chain decode failed: {}", e)))?;
    }

    return_buffer(&mut cx, &current.data)
}

/// The number of codecs in the chain. Args: handle.
pub fn codec_chain_len(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let handle = cx.argument::<JsBox<CodecChainHandle>>(0)?;
    Ok(cx.number(handle.specs.len() as f64))
}
