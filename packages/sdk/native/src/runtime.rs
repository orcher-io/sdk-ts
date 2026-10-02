//! Bridge between async Rust (Tokio) and JavaScript promises.
//!
//! Holds the process-wide Tokio runtime, turns Rust futures into JavaScript promises, and
//! converts values between JavaScript and `serde_json`.
//!
//! ```text
//! JavaScript Promise
//!     ↓
//! Neon JsPromise
//!     ↓
//! Runtime::execute() → spawns task on Tokio runtime
//!     ↓
//! Rust Future (async fn)
//!     ↓
//! Result → Channel → resolve/reject Promise
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use neon::prelude::*;
//! use crate::runtime::Runtime;
//!
//! fn server_version(mut cx: FunctionContext) -> JsResult<JsPromise> {
//!     Runtime::global().execute::<_, _, String>(&mut cx, async move {
//!         // Any async work; an `Err(String)` rejects the promise.
//!         Ok("1.0.0".to_string())
//!     })
//! }
//! ```

use neon::prelude::*;
use neon::types::JsPromise;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::runtime::Runtime as TokioRuntime;

/// The process-wide Tokio runtime.
///
/// Every async operation in the binding runs on it: a multi-threaded scheduler with four
/// worker threads named `orcher-neon-worker`.
static GLOBAL_RUNTIME: Lazy<Arc<TokioRuntime>> = Lazy::new(|| {
    Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("orcher-neon-worker")
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime"),
    )
});

/// Handle to the global runtime, used to run futures from Neon functions.
pub struct Runtime {
    runtime: Arc<TokioRuntime>,
}

impl Runtime {
    /// A handle to the global runtime.
    pub fn global() -> Self {
        Self {
            runtime: GLOBAL_RUNTIME.clone(),
        }
    }

    /// Run a future on the Tokio runtime and return a JavaScript promise for its result.
    ///
    /// The future runs off the JavaScript thread. When it completes, the result is sent
    /// back to the JavaScript thread through a Neon channel: `Ok` resolves the promise with
    /// the value converted by `IntoJs`, and `Err` rejects it with an `Error` whose message
    /// is the error string.
    ///
    /// # Type Parameters
    ///
    /// - `F`: The future type (must be `Send + 'static`)
    /// - `T`: The success type (must implement `IntoJs`)
    /// - `E`: The error type (must implement `Into<String>`)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let promise = runtime.execute(&mut cx, async {
    ///     let result = some_async_operation().await?;
    ///     Ok(result)
    /// })?;
    /// ```
    pub fn execute<'a, F, T, E>(
        &self,
        cx: &mut FunctionContext<'a>,
        future: F,
    ) -> JsResult<'a, JsPromise>
    where
        F: std::future::Future<Output = Result<T, E>> + Send + 'static,
        T: IntoJs + Send + 'static,
        E: Into<String> + Send + 'static,
    {
        let (deferred, promise) = cx.promise();
        let channel = cx.channel();
        let runtime = self.runtime.clone();

        runtime.spawn(async move {
            let result = future.await;

            channel.send(move |mut cx| {
                let channel = cx.channel();
                match result {
                    Ok(value) => {
                        deferred.settle_with(&channel, move |mut cx| value.into_js(&mut cx));
                    }
                    Err(error) => {
                        let error_message: String = error.into();
                        deferred.settle_with(
                            &channel,
                            move |mut cx: TaskContext| -> NeonResult<Handle<JsValue>> {
                                cx.throw_error(&error_message)
                            },
                        );
                    }
                }
                Ok(())
            });
        });

        Ok(promise)
    }
}

/// Conversion of an async operation's success value into a JavaScript value.
///
/// `Runtime::execute` uses it to resolve the promise.
pub trait IntoJs {
    /// Convert this value into a JavaScript value.
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue>;
}

impl IntoJs for () {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.undefined().upcast())
    }
}

impl IntoJs for String {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.string(self).upcast())
    }
}

impl IntoJs for &str {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.string(self).upcast())
    }
}

impl IntoJs for bool {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.boolean(self).upcast())
    }
}

impl IntoJs for i32 {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.number(self).upcast())
    }
}

// 64-bit integers become JavaScript numbers, which are exact only up to 2^53.
impl IntoJs for i64 {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.number(self as f64).upcast())
    }
}

impl IntoJs for u32 {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.number(self).upcast())
    }
}

impl IntoJs for u64 {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.number(self as f64).upcast())
    }
}

impl IntoJs for f64 {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.number(self).upcast())
    }
}

/// `None` becomes `null`.
impl<T: IntoJs> IntoJs for Option<T> {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        match self {
            Some(value) => value.into_js(cx),
            None => Ok(cx.null().upcast()),
        }
    }
}

impl<T: IntoJs> IntoJs for Vec<T> {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let array = cx.empty_array();
        for (i, item) in self.into_iter().enumerate() {
            let js_item = item.into_js(cx)?;
            array.set(cx, i as u32, js_item)?;
        }
        Ok(array.upcast())
    }
}

/// Implement `IntoJs` for an opaque handle type by boxing it in a `JsBox`.
///
/// The second argument is not used.
#[macro_export]
macro_rules! impl_into_js_for_handle {
    ($handle_type:ty, $js_type:ty) => {
        impl IntoJs for $handle_type {
            fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
                Ok(cx.boxed(self).upcast::<JsValue>())
            }
        }
    };
}

/// Converts JSON to the equivalent plain JavaScript value.
impl IntoJs for serde_json::Value {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        json_value_to_js(cx, self)
    }
}

/// Convert a `serde_json::Value` to a JavaScript value.
///
/// Numbers become JavaScript numbers, so integers beyond 2^53 lose precision.
fn json_value_to_js<'a, C: Context<'a>>(
    cx: &mut C,
    value: serde_json::Value,
) -> JsResult<'a, JsValue> {
    match value {
        serde_json::Value::Null => Ok(cx.null().upcast()),
        serde_json::Value::Bool(b) => Ok(cx.boolean(b).upcast()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(cx.number(i as f64).upcast())
            } else if let Some(u) = n.as_u64() {
                Ok(cx.number(u as f64).upcast())
            } else if let Some(f) = n.as_f64() {
                Ok(cx.number(f).upcast())
            } else {
                cx.throw_error("Invalid JSON number")
            }
        }
        serde_json::Value::String(s) => Ok(cx.string(s).upcast()),
        serde_json::Value::Array(arr) => {
            let js_array = cx.empty_array();
            for (i, item) in arr.into_iter().enumerate() {
                let js_item = json_value_to_js(cx, item)?;
                js_array.set(cx, i as u32, js_item)?;
            }
            Ok(js_array.upcast())
        }
        serde_json::Value::Object(obj) => {
            let js_object = cx.empty_object();
            for (key, value) in obj.into_iter() {
                let js_value = json_value_to_js(cx, value)?;
                js_object.set(cx, key.as_str(), js_value)?;
            }
            Ok(js_object.upcast())
        }
    }
}

/// Convert a JavaScript value to a `serde_json::Value`.
///
/// `null` and `undefined` become `null`. Objects contribute their own property names only.
/// Throws for values with no JSON form, such as functions and symbols.
pub fn js_value_to_json<'a, C: Context<'a>>(
    cx: &mut C,
    value: Handle<'a, JsValue>,
) -> NeonResult<serde_json::Value> {
    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        Ok(serde_json::Value::Null)
    } else if value.is_a::<JsBoolean, _>(cx) {
        let b = value.downcast::<JsBoolean, _>(cx).or_throw(cx)?;
        Ok(serde_json::Value::Bool(b.value(cx)))
    } else if value.is_a::<JsNumber, _>(cx) {
        let n = value.downcast::<JsNumber, _>(cx).or_throw(cx)?;
        let num = n.value(cx);
        Ok(serde_json::json!(num))
    } else if value.is_a::<JsString, _>(cx) {
        let s = value.downcast::<JsString, _>(cx).or_throw(cx)?;
        Ok(serde_json::Value::String(s.value(cx)))
    } else if value.is_a::<JsArray, _>(cx) {
        let arr = value.downcast::<JsArray, _>(cx).or_throw(cx)?;
        let len = arr.len(cx);
        let mut vec = Vec::with_capacity(len as usize);
        for i in 0..len {
            let item = arr.get(cx, i)?;
            vec.push(js_value_to_json(cx, item)?);
        }
        Ok(serde_json::Value::Array(vec))
    } else if value.is_a::<JsObject, _>(cx) {
        let obj = value.downcast::<JsObject, _>(cx).or_throw(cx)?;
        let keys = obj.get_own_property_names(cx)?;
        let len = keys.len(cx);
        let mut map = serde_json::Map::new();
        for i in 0..len {
            let key: Handle<JsValue> = keys.get(cx, i)?;
            let key_str = key.downcast::<JsString, _>(cx).or_throw(cx)?.value(cx);
            let value = obj.get(cx, key)?;
            map.insert(key_str, js_value_to_json(cx, value)?);
        }
        Ok(serde_json::Value::Object(map))
    } else {
        cx.throw_error("Unsupported JavaScript type for JSON conversion")
    }
}
