//! Helpers that read typed properties from JavaScript objects.
//!
//! `null` and `undefined` count as absent. A present value of the wrong type throws a
//! JavaScript error naming the property.

use neon::prelude::*;

/// Read a required string property; throws when it is absent.
pub fn get_string_property<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<String> {
    let value: Handle<JsValue> = obj.get(cx, key)?;

    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        return cx.throw_error(format!("Missing required property: {}", key));
    }

    let js_string = value
        .downcast::<JsString, _>(cx)
        .or_else(|_| cx.throw_error(format!("Property '{}' must be a string", key)))?;

    Ok(js_string.value(cx))
}

/// Read an optional string property.
pub fn get_optional_string_property<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<String>> {
    let value: Handle<JsValue> = obj.get(cx, key)?;

    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }

    let js_string = value
        .downcast::<JsString, _>(cx)
        .or_else(|_| cx.throw_error(format!("Property '{}' must be a string", key)))?;

    Ok(Some(js_string.value(cx)))
}

/// Read an optional boolean property.
pub fn get_optional_bool_property<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<bool>> {
    let value: Handle<JsValue> = obj.get(cx, key)?;

    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }

    let js_bool = value
        .downcast::<JsBoolean, _>(cx)
        .or_else(|_| cx.throw_error(format!("Property '{}' must be a boolean", key)))?;

    Ok(Some(js_bool.value(cx)))
}

/// Read an optional number property.
pub fn get_optional_number_property<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<f64>> {
    let value: Handle<JsValue> = obj.get(cx, key)?;

    if value.is_a::<JsNull, _>(cx) || value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }

    let js_number = value
        .downcast::<JsNumber, _>(cx)
        .or_else(|_| cx.throw_error(format!("Property '{}' must be a number", key)))?;

    Ok(Some(js_number.value(cx)))
}
