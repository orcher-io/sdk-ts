//! Neon bindings for actor operations.
//!
//! Polling and completion go through sdk-core's `ActorDriver`, in the same way workflow
//! tasks and tasks go through `WorkflowDriver` and `TaskDriver`. State RPCs, handler
//! registration and client-side invocation are direct gRPC calls.
//!
//! ## Functions
//!
//! - `poll_actor_operation`: receive an actor operation from a fan-out slot (worker side).
//! - `complete_actor_operation`: send the result back through the `ActorDriver` (worker side).
//! - `client_invoke_actor_operation`: invoke an operation and wait for its result (client side).
//! - `actor_get_state`, `actor_set_state`, `actor_delete_state`, `actor_list_state_keys`:
//!   actor state RPCs (direct gRPC).
//! - `register_actor_handlers`: announce the actor operations this worker handles.

use neon::prelude::*;
use neon::types::buffer::TypedArray;
use std::sync::atomic::Ordering;
use std::time::Duration;

use crate::client::ClientHandleType;
use crate::runtime::Runtime;
use crate::worker::WorkerHandleType;

use orcher_proto::orcher::v1::{
    ActorHandler, DeleteStateRequest, GetStateRequest, ListStateKeysRequest, OperationMode,
    RegisterHandlersRequest, SetStateRequest,
};
use orcher_sdk_core::client::CoreActorClient;
use orcher_sdk_core::poller::ActorWorkResult;
use tonic::transport::Channel;

// ============================================================================
// State response types. Values cross to JavaScript as Buffers, not base64 strings.
// ============================================================================

/// Result of `GetState`, returned to JavaScript as `{ value: Uint8Array, exists: boolean }`.
struct GetStateResult {
    value: Vec<u8>,
    exists: bool,
}

impl crate::runtime::IntoJs for GetStateResult {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let obj = cx.empty_object();
        let value_buf = JsBuffer::from_slice(cx, &self.value)?;
        obj.set(cx, "value", value_buf)?;
        let exists = cx.boolean(self.exists);
        obj.set(cx, "exists", exists)?;
        Ok(obj.upcast())
    }
}

/// Result of `SetState`, returned to JavaScript as `{ success: boolean }`.
struct SetStateResult {
    success: bool,
}

impl crate::runtime::IntoJs for SetStateResult {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let obj = cx.empty_object();
        let success = cx.boolean(self.success);
        obj.set(cx, "success", success)?;
        Ok(obj.upcast())
    }
}

/// Result of `DeleteState`, returned to JavaScript as `{ existed: boolean }`.
struct DeleteStateResult {
    existed: bool,
}

impl crate::runtime::IntoJs for DeleteStateResult {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let obj = cx.empty_object();
        let existed = cx.boolean(self.existed);
        obj.set(cx, "existed", existed)?;
        Ok(obj.upcast())
    }
}

/// Result of `ListStateKeys`, returned to JavaScript as `{ keys: string[] }`.
struct ListStateKeysResult {
    keys: Vec<String>,
}

impl crate::runtime::IntoJs for ListStateKeysResult {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let obj = cx.empty_object();
        let arr = cx.empty_array();
        for (i, key) in self.keys.iter().enumerate() {
            let js_key = cx.string(key);
            arr.set(cx, i as u32, js_key)?;
        }
        obj.set(cx, "keys", arr)?;
        Ok(obj.upcast())
    }
}

// ============================================================================
// Poll actor operation (worker side, fan-out channel fed by the ActorDriver)
// ============================================================================

/// Poll one fan-out slot for an actor operation.
///
/// Receives work from the `ActorDriver`'s fan-out channel, like `pollWorkflowTask` and
/// `pollTask`. Each TypeScript polling loop uses its own slot index, so loops poll in
/// parallel without contending for one lock. Resolves to the operation as a JSON string,
/// or `null` when no work arrives within 30 seconds. Rejects when the worker is shutting
/// down.
///
/// JavaScript signature:
/// ```typescript
/// function pollActorOperation(service: ServiceHandle, slotIndex: number): Promise<string | null>;
/// ```
pub fn poll_actor_operation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let slot_index = cx.argument::<JsNumber>(1)?.value(&mut cx) as usize;

    let actor_fan_out = service_box.actor_fan_out.clone();
    let slot_count = service_box.actor_slot_count.load(Ordering::SeqCst);

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        if slot_count == 0 {
            return Err("Actor driver not started (actor_poller_count is 0)".to_string());
        }

        if slot_index >= slot_count {
            return Err(format!(
                "Invalid actor slot index {}, max is {}",
                slot_index,
                slot_count.saturating_sub(1)
            ));
        }

        let fan_out_guard = actor_fan_out.lock().await;
        let fan_out = fan_out_guard
            .as_ref()
            .ok_or_else(|| "Actor driver not started".to_string())?;

        if *fan_out.shutdown_rx.borrow() {
            return Err("Service is shutting down".to_string());
        }

        let slot_receiver = fan_out.slot_receivers[slot_index].clone();
        let mut shutdown_rx = fan_out.shutdown_rx.clone();

        // Release the shared fan-out lock before waiting, so other slots can poll while
        // this one blocks. Only this slot's receiver stays locked.
        drop(fan_out_guard);

        let mut receiver = slot_receiver.lock().await;

        // `biased` checks shutdown first, so a worker that is stopping never hands out
        // new work.
        tokio::select! {
            biased;

            result = shutdown_rx.changed() => {
                if result.is_err() || *shutdown_rx.borrow() {
                    return Err("Service is shutting down".to_string());
                }
                Ok(None)
            }

            work = receiver.recv() => {
                match work {
                    Some(serialized_work) => {
                        tracing::debug!(
                            "POLL_ACTOR_OPERATION slot {}: Received work",
                            slot_index
                        );
                        Ok(Some(serialized_work.json_str))
                    }
                    None => {
                        Err("Actor slot channel closed".to_string())
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                // No work within the poll window; JavaScript polls again.
                Ok(None)
            }
        }
    })
}

// ============================================================================
// Complete actor operation (worker side, through sdk-core's ActorDriver)
// ============================================================================

/// Complete an actor operation by handing its result to sdk-core.
///
/// The `ActorDriver` in sdk-core makes the gRPC completion call. When `success` is false,
/// `errorMessage` (or "Unknown error") becomes the operation's failure.
///
/// JavaScript signature:
/// ```typescript
/// function completeActorOperation(
///   service: ServiceHandle,
///   operationId: string,
///   executionId: string,
///   result: Uint8Array,
///   success: boolean,
///   errorMessage?: string
/// ): Promise<void>;
/// ```
pub fn complete_actor_operation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let operation_id = cx.argument::<JsString>(1)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(2)?.value(&mut cx);

    let result_buf = cx.argument::<JsBuffer>(3)?;
    let result_bytes = result_buf.as_slice(&cx).to_vec();

    let success = cx.argument::<JsBoolean>(4)?.value(&mut cx);

    let error_message = if cx.len() > 5 {
        let val = cx.argument::<JsValue>(5)?;
        if val.is_a::<JsString, _>(&mut cx) {
            Some(val.downcast::<JsString, _>(&mut cx).unwrap().value(&mut cx))
        } else {
            None
        }
    } else {
        None
    };

    let result_tx = {
        let guard = service_box.senders.read().unwrap();
        let senders = guard
            .as_ref()
            .ok_or_else(|| cx.throw_error::<_, ()>("Service not started").unwrap_err())?;
        senders.actor_result_tx.clone()
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let work_result = if success {
            ActorWorkResult {
                operation_id,
                execution_id,
                result: Ok(result_bytes),
            }
        } else {
            let err_msg = error_message.unwrap_or_else(|| "Unknown error".to_string());
            ActorWorkResult {
                operation_id,
                execution_id,
                result: Err(orcher_sdk_core::error::Error::internal(err_msg)),
            }
        };

        result_tx
            .send(work_result)
            .await
            .map_err(|e| format!("Failed to send actor result to sdk-core: {}", e))?;

        Ok(())
    })
}

// ============================================================================
// Client invoke actor operation (client side)
// ============================================================================

/// Invoke an actor operation from a client and wait for its result.
///
/// Opens a channel to the client's server URL and calls sdk-core's `CoreActorClient`,
/// which wraps `ActorServiceClient`.
///
/// JavaScript signature:
/// ```typescript
/// function clientInvokeActorOperation(
///   client: ClientHandle,
///   actorName: string,
///   key: string,
///   operation: string,
///   payload: Uint8Array
/// ): Promise<Uint8Array>;
/// ```
pub fn client_invoke_actor_operation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;
    let actor_name = cx.argument::<JsString>(1)?.value(&mut cx);
    let key = cx.argument::<JsString>(2)?.value(&mut cx);
    let operation = cx.argument::<JsString>(3)?.value(&mut cx);

    let payload_buf = cx.argument::<JsBuffer>(4)?;
    let payload = payload_buf.as_slice(&cx).to_vec();

    let server_url = client_box.server_url.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let channel = Channel::from_shared(server_url)
            .map_err(|e| format!("Invalid server URL: {}", e))?
            .connect()
            .await
            .map_err(|e| format!("Failed to connect for actor invoke: {}", e))?;

        let actor_client = CoreActorClient::new(channel);

        let result = actor_client
            .invoke_operation(actor_name, key, operation, payload, None, None)
            .await
            .map_err(|e| format!("Actor invoke failed: {}", e))?;

        Ok(result)
    })
}

/// Returns bytes to JavaScript as a Node.js `Buffer`, which is a `Uint8Array`.
impl crate::runtime::IntoJs for Vec<u8> {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let buf = JsBuffer::from_slice(cx, &self)?;
        Ok(buf.upcast())
    }
}

// ============================================================================
// Actor state operations (worker side)
// ============================================================================

/// Read one state key of an actor instance.
///
/// JavaScript signature:
/// ```typescript
/// function actorGetState(
///   service: ServiceHandle,
///   actorName: string,
///   key: string,
///   stateKey: string,
///   executionId: string
/// ): Promise<{ value: Uint8Array, exists: boolean }>;
/// ```
pub fn actor_get_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let actor_name = cx.argument::<JsString>(1)?.value(&mut cx);
    let key = cx.argument::<JsString>(2)?.value(&mut cx);
    let state_key = cx.argument::<JsString>(3)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(4)?.value(&mut cx);

    let actor_client_holder = service_box.actor_state_client.clone();
    let config = service_box.config.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut client = get_actor_client(&actor_client_holder, &config.server_url).await?;

        let request = GetStateRequest {
            actor_name,
            key,
            state_key,
            execution_id,
            ..Default::default()
        };

        let response = client
            .get_state(request)
            .await
            .map_err(|e| format!("GetState gRPC error: {}", e))?
            .into_inner();

        Ok(GetStateResult {
            value: response.value,
            exists: response.exists,
        })
    })
}

/// Write one state key of an actor instance.
///
/// The write is unconditional: no expected version is sent.
///
/// JavaScript signature:
/// ```typescript
/// function actorSetState(
///   service: ServiceHandle,
///   actorName: string,
///   key: string,
///   stateKey: string,
///   value: Uint8Array,
///   executionId: string
/// ): Promise<{ success: boolean }>;
/// ```
pub fn actor_set_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let actor_name = cx.argument::<JsString>(1)?.value(&mut cx);
    let key = cx.argument::<JsString>(2)?.value(&mut cx);
    let state_key = cx.argument::<JsString>(3)?.value(&mut cx);

    let value_buf = cx.argument::<JsBuffer>(4)?;
    let value = value_buf.as_slice(&cx).to_vec();

    let execution_id = cx.argument::<JsString>(5)?.value(&mut cx);

    let actor_client_holder = service_box.actor_state_client.clone();
    let config = service_box.config.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut client = get_actor_client(&actor_client_holder, &config.server_url).await?;

        let request = SetStateRequest {
            actor_name,
            key,
            state_key,
            value,
            execution_id,
            expected_version: String::new(),
            ..Default::default()
        };

        let response = client
            .set_state(request)
            .await
            .map_err(|e| format!("SetState gRPC error: {}", e))?
            .into_inner();

        Ok(SetStateResult {
            success: response.success,
        })
    })
}

/// Delete one state key of an actor instance.
///
/// JavaScript signature:
/// ```typescript
/// function actorDeleteState(
///   service: ServiceHandle,
///   actorName: string,
///   key: string,
///   stateKey: string,
///   executionId: string
/// ): Promise<{ existed: boolean }>;
/// ```
pub fn actor_delete_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let actor_name = cx.argument::<JsString>(1)?.value(&mut cx);
    let key = cx.argument::<JsString>(2)?.value(&mut cx);
    let state_key = cx.argument::<JsString>(3)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(4)?.value(&mut cx);

    let actor_client_holder = service_box.actor_state_client.clone();
    let config = service_box.config.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut client = get_actor_client(&actor_client_holder, &config.server_url).await?;

        let request = DeleteStateRequest {
            actor_name,
            key,
            state_key,
            execution_id,
            ..Default::default()
        };

        let response = client
            .delete_state(request)
            .await
            .map_err(|e| format!("DeleteState gRPC error: {}", e))?
            .into_inner();

        Ok(DeleteStateResult {
            existed: response.existed,
        })
    })
}

/// List the state keys of an actor instance, optionally filtered by prefix.
///
/// JavaScript signature:
/// ```typescript
/// function actorListStateKeys(
///   service: ServiceHandle,
///   actorName: string,
///   key: string,
///   executionId: string,
///   prefix?: string
/// ): Promise<{ keys: string[] }>;
/// ```
pub fn actor_list_state_keys(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let actor_name = cx.argument::<JsString>(1)?.value(&mut cx);
    let key = cx.argument::<JsString>(2)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(3)?.value(&mut cx);

    let prefix = if cx.len() > 4 {
        let val = cx.argument::<JsValue>(4)?;
        if val.is_a::<JsString, _>(&mut cx) {
            Some(val.downcast::<JsString, _>(&mut cx).unwrap().value(&mut cx))
        } else {
            None
        }
    } else {
        None
    };

    let actor_client_holder = service_box.actor_state_client.clone();
    let config = service_box.config.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut client = get_actor_client(&actor_client_holder, &config.server_url).await?;

        let request = ListStateKeysRequest {
            actor_name,
            key,
            execution_id,
            prefix: prefix.unwrap_or_default(),
            ..Default::default()
        };

        let response = client
            .list_state_keys(request)
            .await
            .map_err(|e| format!("ListStateKeys gRPC error: {}", e))?
            .into_inner();

        Ok(ListStateKeysResult {
            keys: response.keys,
        })
    })
}

// ============================================================================
// Register actor handlers (worker side, RegisterHandlers gRPC)
// ============================================================================

/// Register this worker's actor handlers with the server.
///
/// Calls the `RegisterHandlers` gRPC endpoint to announce which actor operations this
/// worker handles. Pass the returned `registration_id` to `serviceStart()` as its fifth
/// argument. A `mode` of `"shared"` registers the operation as shared; any other value,
/// or none, registers it as exclusive. Unparseable metadata JSON is treated as empty.
///
/// JavaScript signature:
/// ```typescript
/// function registerActorHandlers(
///   service: ServiceHandle,
///   handlersJson: string,  // JSON array of { actor_name, operation, mode }
///   metadataJson: string   // JSON object of key-value metadata
/// ): Promise<string>;
/// // Resolves to JSON: { success, registration_id, handlers_registered, error_message }
/// ```
pub fn register_actor_handlers(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let handlers_json = cx.argument::<JsString>(1)?.value(&mut cx);
    let metadata_json = cx.argument::<JsString>(2)?.value(&mut cx);

    let server_url = service_box.config.server_url.clone();
    let service_id = service_box.actor_service_id.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let handler_entries: Vec<serde_json::Value> = serde_json::from_str(&handlers_json)
            .map_err(|e| format!("Invalid handlers JSON: {}", e))?;

        let proto_handlers: Vec<ActorHandler> = handler_entries
            .into_iter()
            .map(|h| {
                // Map through the proto enum rather than literal numbers: on the wire
                // EXCLUSIVE is 1 and SHARED is 2, and sending the wrong one makes a shared
                // operation run exclusively, without concurrent execution.
                let mode = match h["mode"].as_str().unwrap_or("exclusive") {
                    "shared" => OperationMode::Shared as i32,
                    _ => OperationMode::Exclusive as i32,
                };
                ActorHandler {
                    actor_name: h["actor_name"].as_str().unwrap_or("").to_string(),
                    operation: h["operation"].as_str().unwrap_or("").to_string(),
                    mode,
                    metadata: std::collections::HashMap::new(),
                    ..Default::default()
                }
            })
            .collect();

        let metadata: std::collections::HashMap<String, String> =
            serde_json::from_str(&metadata_json).unwrap_or_default();

        let channel = Channel::from_shared(server_url)
            .map_err(|e| format!("Invalid server URL: {}", e))?
            .connect()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        let max = orcher_sdk_core::limits::default_max_message_bytes();
        let mut client =
            orcher_proto::orcher::v1::actor_service_client::ActorServiceClient::new(channel)
                .max_decoding_message_size(max)
                .max_encoding_message_size(max);

        let request = RegisterHandlersRequest {
            service_id,
            handlers: proto_handlers,
            metadata,
            ..Default::default()
        };

        let response = client
            .register_handlers(request)
            .await
            .map_err(|e| format!("RegisterHandlers gRPC error: {}", e))?
            .into_inner();

        let result = serde_json::json!({
            "success": response.success,
            "registration_id": response.registration_id,
            "handlers_registered": response.handlers_registered,
            "error_message": response.error_message,
        });

        Ok(serde_json::to_string(&result)
            .map_err(|e| format!("Failed to serialize response: {}", e))?)
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Return the worker's cached actor-state client, connecting on first use.
async fn get_actor_client(
    holder: &tokio::sync::Mutex<
        Option<orcher_proto::orcher::v1::actor_service_client::ActorServiceClient<Channel>>,
    >,
    server_url: &str,
) -> Result<orcher_proto::orcher::v1::actor_service_client::ActorServiceClient<Channel>, String> {
    let mut guard = holder.lock().await;
    if let Some(client) = guard.as_ref() {
        return Ok(client.clone());
    }
    let channel = Channel::from_shared(server_url.to_string())
        .map_err(|e| format!("Invalid server URL: {}", e))?
        .connect()
        .await
        .map_err(|e| format!("Failed to connect actor client: {}", e))?;
    // Actor state up to the configured message limit, not tonic's 4 MiB.
    let max = orcher_sdk_core::limits::default_max_message_bytes();
    let client = orcher_proto::orcher::v1::actor_service_client::ActorServiceClient::new(channel)
        .max_decoding_message_size(max)
        .max_encoding_message_size(max);
    *guard = Some(client.clone());
    Ok(client)
}
