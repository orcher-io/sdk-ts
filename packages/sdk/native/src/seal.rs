//! The payload seal a client or a worker is configured with.
//!
//! A connection given a seal encodes every payload as its call leaves for the
//! engine and decodes every payload as one arrives, inside sdk-core. The
//! engine stores what it is sent and never holds a key; TypeScript sees plain
//! payloads only. This module turns the `compression` and `encryption`
//! options into that seal, the same way for the client (which reads them from
//! a JavaScript object) and the worker (which reads them from JSON).
//!
//! Nothing here prints key material: the types that hold keys write their
//! `Debug` output by hand, and errors name a key by its id and length only.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use serde::Deserialize;

use orcher_sdk_core::payload::codec::{CodecChain, EncryptionPayloadCodec, GzipPayloadCodec};
use orcher_sdk_core::payload::PayloadSeal;

use crate::error_code::tagged_as;
use crate::types::get_optional_string_property;

/// The length of an AES-256-GCM key.
const KEY_BYTES: usize = 32;

/// The `compression` and `encryption` options of one client or worker.
#[derive(Debug, Default)]
pub struct SealSettings {
    /// The compression to apply; `gzip` is the only one.
    pub compression: Option<String>,
    pub encryption: Option<EncryptionSettings>,
}

/// The `encryption` option: the key to encrypt with, its name, and keys kept
/// for reading what was encrypted before a rotation.
pub struct EncryptionSettings {
    key: Vec<u8>,
    key_id: Option<String>,
    decryption_keys: Vec<(String, Vec<u8>)>,
}

// Written by hand so that debug output can never print key material.
impl std::fmt::Debug for EncryptionSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptionSettings")
            .field("key", &"<redacted>")
            .field("key_id", &self.key_id)
            .field("decryption_keys", &self.decryption_keys.len())
            .finish()
    }
}

fn invalid(reason: impl std::fmt::Display) -> String {
    tagged_as("INVALID_ARGUMENT", reason, "invalid payload settings")
}

/// `key` as the array the cipher takes; `name` is how the error calls it.
fn key_array(name: &str, key: &[u8]) -> Result<[u8; KEY_BYTES], String> {
    key.try_into().map_err(|_| {
        invalid(format!(
            "{name} must be exactly {KEY_BYTES} bytes (AES-256-GCM), got {}",
            key.len()
        ))
    })
}

impl SealSettings {
    /// The seal these settings ask for, or `None` when they ask for nothing.
    ///
    /// With both set, a payload is compressed and then encrypted: ciphertext
    /// does not compress.
    pub fn into_seal(self) -> Result<Option<PayloadSeal>, String> {
        let mut chain = CodecChain::new();
        match self.compression.as_deref() {
            None => {}
            Some("gzip") => chain = chain.with_codec(GzipPayloadCodec::default()),
            Some(other) => {
                return Err(invalid(format!(
                    "compression must be 'gzip', got '{other}'"
                )))
            }
        }
        if let Some(encryption) = self.encryption {
            let mut codec =
                EncryptionPayloadCodec::new(&key_array("encryption.key", &encryption.key)?);
            if let Some(key_id) = encryption.key_id {
                codec = codec.with_key_id(key_id);
            }
            for (key_id, key) in encryption.decryption_keys {
                let name = format!("encryption.decryptionKeys['{key_id}']");
                codec = codec.with_decryption_key(key_id, &key_array(&name, &key)?);
            }
            chain = chain.with_codec(codec);
        }
        Ok((!chain.is_empty()).then(|| PayloadSeal::new(chain)))
    }

    /// Reads the settings from a JavaScript config object: `compression`, a
    /// string, and `encryption`, an object holding `key` (a `Uint8Array`),
    /// `keyId` and `decryptionKeys` (an object of `Uint8Array`s by key id).
    pub fn from_js<'a, C: Context<'a>>(cx: &mut C, obj: Handle<'a, JsObject>) -> NeonResult<Self> {
        let compression = get_optional_string_property(cx, obj, "compression")?;
        let Some(encryption) = optional_object(cx, obj, "encryption")? else {
            return Ok(Self {
                compression,
                encryption: None,
            });
        };
        let key = key_property(cx, encryption, "key", "encryption.key")?;
        let key_id = get_optional_string_property(cx, encryption, "keyId")?;
        let mut decryption_keys = Vec::new();
        if let Some(keys) = optional_object(cx, encryption, "decryptionKeys")? {
            let names = keys.get_own_property_names(cx)?.to_vec(cx)?;
            for name in names {
                let key_id = name
                    .downcast::<JsString, _>(cx)
                    .or_else(|_| cx.throw_error("encryption.decryptionKeys must be keyed by id"))?
                    .value(cx);
                let label = format!("encryption.decryptionKeys['{key_id}']");
                let key = key_property(cx, keys, key_id.as_str(), &label)?;
                decryption_keys.push((key_id, key));
            }
        }
        Ok(Self {
            compression,
            encryption: Some(EncryptionSettings {
                key,
                key_id,
                decryption_keys,
            }),
        })
    }
}

/// An object property, with `null` and `undefined` read as absent.
fn optional_object<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<'a, JsObject>,
    key: &str,
) -> NeonResult<Option<Handle<'a, JsObject>>> {
    let value: Handle<JsValue> = obj.get(cx, key)?;
    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }
    value
        .downcast::<JsObject, _>(cx)
        .map(Some)
        .or_else(|_| cx.throw_error(format!("{key} must be an object")))
}

/// The bytes of a key held in a `Uint8Array` property. `label` is how an
/// error calls it; the value is never part of one.
fn key_property<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
    key: &str,
    label: &str,
) -> NeonResult<Vec<u8>> {
    let value: Handle<JsValue> = obj.get(cx, key)?;
    let bytes = value
        .downcast::<JsTypedArray<u8>, _>(cx)
        .or_else(|_| cx.throw_error(format!("{label} must be a Uint8Array")))?;
    Ok(bytes.as_slice(cx).to_vec())
}

/// The `encryption` option as the worker's JSON configuration carries it:
/// every key as standard base64.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionJson {
    key: String,
    key_id: Option<String>,
    #[serde(default)]
    decryption_keys: BTreeMap<String, String>,
}

// Written by hand so that debug output can never print key material.
impl std::fmt::Debug for EncryptionJson {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptionJson")
            .field("key", &"<redacted>")
            .field("key_id", &self.key_id)
            .field("decryption_keys", &self.decryption_keys.len())
            .finish()
    }
}

impl EncryptionJson {
    /// The keys, decoded. A key that is not base64 is refused without saying
    /// what it held.
    pub fn into_settings(self) -> Result<EncryptionSettings, String> {
        let decode = |name: &str, key: &str| {
            BASE64
                .decode(key)
                .map_err(|_| invalid(format!("{name} is not standard base64")))
        };
        let key = decode("encryption.key", &self.key)?;
        let mut decryption_keys = Vec::with_capacity(self.decryption_keys.len());
        for (key_id, encoded) in self.decryption_keys {
            let key = decode(&format!("encryption.decryptionKeys['{key_id}']"), &encoded)?;
            decryption_keys.push((key_id, key));
        }
        Ok(EncryptionSettings {
            key,
            key_id: self.key_id,
            decryption_keys,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encryption(key: Vec<u8>) -> EncryptionSettings {
        EncryptionSettings {
            key,
            key_id: None,
            decryption_keys: Vec::new(),
        }
    }

    fn sealed(seal: &PayloadSeal, plain: &[u8]) -> serde_json::Value {
        serde_json::from_slice(&seal.seal(plain).unwrap()).unwrap()
    }

    #[test]
    fn no_settings_make_no_seal() {
        assert!(SealSettings::default().into_seal().unwrap().is_none());
    }

    #[test]
    fn encryption_seals_with_the_named_key() {
        let mut settings = encryption(vec![7; 32]);
        settings.key_id = Some("k1".into());
        let seal = SealSettings {
            compression: None,
            encryption: Some(settings),
        }
        .into_seal()
        .unwrap()
        .unwrap();
        let envelope = sealed(&seal, br#"{"card":"4242"}"#);
        assert_eq!(envelope["metadata"]["encoding"], "binary/encrypted");
        assert_eq!(envelope["metadata"]["encryption-key-id"], "k1");
        assert!(!envelope.to_string().contains("4242"));
    }

    #[test]
    fn compression_alone_seals_as_gzip() {
        let seal = SealSettings {
            compression: Some("gzip".into()),
            encryption: None,
        }
        .into_seal()
        .unwrap()
        .unwrap();
        let envelope = sealed(&seal, br#"{"a":1}"#);
        assert_eq!(envelope["metadata"]["encoding"], "binary/gzip");
        assert_eq!(
            seal.open(&seal.seal(br#"{"a":1}"#).unwrap()).unwrap(),
            Some(br#"{"a":1}"#.to_vec())
        );
    }

    /// Compressed first, then encrypted: the outermost encoding is the
    /// encryption, and a long repetitive value comes out shorter than it
    /// would encrypted alone.
    #[test]
    fn both_compress_and_then_encrypt() {
        let plain = format!("\"{}\"", "a".repeat(4096));
        let both = SealSettings {
            compression: Some("gzip".into()),
            encryption: Some(encryption(vec![7; 32])),
        }
        .into_seal()
        .unwrap()
        .unwrap();
        let alone = SealSettings {
            compression: None,
            encryption: Some(encryption(vec![7; 32])),
        }
        .into_seal()
        .unwrap()
        .unwrap();
        let envelope = sealed(&both, plain.as_bytes());
        let encoding = envelope["metadata"]["encoding"].as_str().unwrap();
        assert!(encoding.contains("encrypted"), "{encoding}");
        assert!(
            both.seal(plain.as_bytes()).unwrap().len()
                < alone.seal(plain.as_bytes()).unwrap().len() / 4
        );
        assert_eq!(
            both.open(&both.seal(plain.as_bytes()).unwrap()).unwrap(),
            Some(plain.into_bytes())
        );
    }

    #[test]
    fn a_key_of_the_wrong_length_is_refused_without_being_printed() {
        let error = SealSettings {
            compression: None,
            encryption: Some(encryption(vec![0xAB; 31])),
        }
        .into_seal()
        .unwrap_err();
        assert!(error.starts_with("[INVALID_ARGUMENT]"), "{error}");
        assert!(error.contains("exactly 32 bytes"), "{error}");
        assert!(error.contains("got 31"), "{error}");
        assert!(!error.contains("171") && !error.to_lowercase().contains("abab"));
    }

    #[test]
    fn a_decryption_key_of_the_wrong_length_is_refused_by_its_id() {
        let mut settings = encryption(vec![1; 32]);
        settings.decryption_keys.push(("old".into(), vec![2; 16]));
        let error = SealSettings {
            compression: None,
            encryption: Some(settings),
        }
        .into_seal()
        .unwrap_err();
        assert!(
            error.contains("encryption.decryptionKeys['old']"),
            "{error}"
        );
        assert!(error.contains("got 16"), "{error}");
    }

    #[test]
    fn an_unknown_compression_is_refused() {
        let error = SealSettings {
            compression: Some("zstd".into()),
            encryption: None,
        }
        .into_seal()
        .unwrap_err();
        assert!(error.contains("compression must be 'gzip'"), "{error}");
    }

    #[test]
    fn a_rotated_out_key_still_opens_what_it_sealed() {
        let mut old = encryption(vec![1; 32]);
        old.key_id = Some("k1".into());
        let old = SealSettings {
            compression: None,
            encryption: Some(old),
        }
        .into_seal()
        .unwrap()
        .unwrap();

        let mut new = encryption(vec![2; 32]);
        new.key_id = Some("k2".into());
        new.decryption_keys.push(("k1".into(), vec![1; 32]));
        let new = SealSettings {
            compression: None,
            encryption: Some(new),
        }
        .into_seal()
        .unwrap()
        .unwrap();

        let stored = old.seal(b"\"before\"").unwrap();
        assert_eq!(new.open(&stored).unwrap(), Some(b"\"before\"".to_vec()));
        assert_eq!(sealed(&new, b"1")["metadata"]["encryption-key-id"], "k2");
        // The old worker does not hold the new key.
        assert!(old.open(&new.seal(b"\"after\"").unwrap()).is_err());
    }

    #[test]
    fn json_keys_are_read_as_base64() {
        let json: EncryptionJson = serde_json::from_str(&format!(
            r#"{{"key":"{}","keyId":"k2","decryptionKeys":{{"k1":"{}"}}}}"#,
            BASE64.encode([2u8; 32]),
            BASE64.encode([1u8; 32]),
        ))
        .unwrap();
        let settings = json.into_settings().unwrap();
        assert_eq!(settings.key, vec![2; 32]);
        assert_eq!(settings.key_id.as_deref(), Some("k2"));
        assert_eq!(
            settings.decryption_keys,
            vec![("k1".to_string(), vec![1; 32])]
        );
    }

    #[test]
    fn a_json_key_that_is_not_base64_is_refused_without_being_printed() {
        let json: EncryptionJson =
            serde_json::from_str(r#"{"key":"not base64 SECRETSECRET!"}"#).unwrap();
        let error = json.into_settings().unwrap_err();
        assert!(error.contains("encryption.key is not standard base64"));
        assert!(!error.contains("SECRET"), "{error}");
    }

    #[test]
    fn debug_output_holds_no_key() {
        let key = BASE64.encode([0x5Au8; 32]);
        let json: EncryptionJson =
            serde_json::from_str(&format!(r#"{{"key":"{key}","keyId":"k1"}}"#)).unwrap();
        let printed = format!("{json:?}");
        assert!(!printed.contains(&key), "{printed}");
        assert!(printed.contains("k1"));

        let settings = SealSettings {
            compression: None,
            encryption: Some(json.into_settings().unwrap()),
        };
        let printed = format!("{settings:?}");
        assert!(!printed.contains("90"), "{printed}");
        assert!(printed.contains("<redacted>"));
    }
}
