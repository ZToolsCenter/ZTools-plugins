use neon::prelude::*;

pub fn required_string_arg(
    cx: &mut FunctionContext,
    index: usize,
    name: &str,
) -> NeonResult<String> {
    let Some(value) = cx.argument_opt(index) else {
        return type_error(cx, name, "a string", "undefined");
    };
    if is_nullish(cx, value) || !value.is_a::<JsString, _>(cx) {
        return type_error_for_value(cx, name, "a string", value);
    }

    Ok(value.downcast_or_throw::<JsString, _>(cx)?.value(cx))
}

pub fn optional_u32_arg(
    cx: &mut FunctionContext,
    index: usize,
    name: &str,
    default_value: u32,
) -> NeonResult<u32> {
    let Some(value) = cx.argument_opt(index) else {
        return Ok(default_value);
    };
    if is_nullish(cx, value) {
        return Ok(default_value);
    }
    if !value.is_a::<JsNumber, _>(cx) {
        return type_error_for_value(cx, name, "a number", value);
    }

    Ok(value.downcast_or_throw::<JsNumber, _>(cx)?.value(cx) as u32)
}

pub fn optional_usize_arg(
    cx: &mut FunctionContext,
    index: usize,
    name: &str,
    default_value: usize,
) -> NeonResult<usize> {
    let Some(value) = cx.argument_opt(index) else {
        return Ok(default_value);
    };
    if is_nullish(cx, value) {
        return Ok(default_value);
    }
    if !value.is_a::<JsNumber, _>(cx) {
        return type_error_for_value(cx, name, "a number", value);
    }

    Ok(value
        .downcast_or_throw::<JsNumber, _>(cx)?
        .value(cx)
        .max(0.0) as usize)
}

pub fn optional_string_arg(
    cx: &mut FunctionContext,
    index: usize,
    name: &str,
    default_value: &str,
) -> NeonResult<String> {
    let Some(value) = cx.argument_opt(index) else {
        return Ok(String::from(default_value));
    };
    if is_nullish(cx, value) {
        return Ok(String::from(default_value));
    }
    if !value.is_a::<JsString, _>(cx) {
        return type_error_for_value(cx, name, "a string", value);
    }

    Ok(value.downcast_or_throw::<JsString, _>(cx)?.value(cx))
}

pub fn optional_bool_arg(
    cx: &mut FunctionContext,
    index: usize,
    name: &str,
    default_value: bool,
) -> NeonResult<bool> {
    let Some(value) = cx.argument_opt(index) else {
        return Ok(default_value);
    };
    if is_nullish(cx, value) {
        return Ok(default_value);
    }
    if !value.is_a::<JsBoolean, _>(cx) {
        return type_error_for_value(cx, name, "a boolean", value);
    }

    Ok(value.downcast_or_throw::<JsBoolean, _>(cx)?.value(cx))
}

pub fn optional_usize_property(
    cx: &mut FunctionContext,
    object: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<usize>> {
    let value = object.get::<JsValue, _, _>(cx, key)?;
    if is_nullish(cx, value) {
        return Ok(None);
    }
    if !value.is_a::<JsNumber, _>(cx) {
        return type_error_for_value(cx, key, "a number", value);
    }

    Ok(Some(
        value
            .downcast_or_throw::<JsNumber, _>(cx)?
            .value(cx)
            .max(0.0) as usize,
    ))
}

pub fn is_nullish(cx: &mut FunctionContext, value: Handle<JsValue>) -> bool {
    value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx)
}

pub fn type_error_for_value<T>(
    cx: &mut FunctionContext,
    name: &str,
    expected: &str,
    value: Handle<JsValue>,
) -> NeonResult<T> {
    let actual = js_type_name(cx, value);
    type_error(cx, name, expected, actual)
}

fn type_error<T>(
    cx: &mut FunctionContext,
    name: &str,
    expected: &str,
    actual: &str,
) -> NeonResult<T> {
    cx.throw_type_error(format!("{name} must be {expected}, got {actual}"))
}

fn js_type_name(cx: &mut FunctionContext, value: Handle<JsValue>) -> &'static str {
    if value.is_a::<JsUndefined, _>(cx) {
        "undefined"
    } else if value.is_a::<JsNull, _>(cx) {
        "null"
    } else if value.is_a::<JsBoolean, _>(cx) {
        "boolean"
    } else if value.is_a::<JsNumber, _>(cx) {
        "number"
    } else if value.is_a::<JsString, _>(cx) {
        "string"
    } else if value.is_a::<JsFunction, _>(cx) {
        "function"
    } else if value.is_a::<JsArray, _>(cx) {
        "array"
    } else if value.is_a::<JsObject, _>(cx) {
        "object"
    } else {
        "unknown"
    }
}
