use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Maximum number of staged transfers kept in memory; oldest entries are
/// evicted first so an abandoned drag can never grow the map unbounded.
const MAX_PENDING_TRANSFERS: usize = 16;

pub struct PendingTransfer {
    pub payload: String,
    pub source_label: String,
}

#[derive(Default)]
struct BrokerInner {
    entries: HashMap<String, PendingTransfer>,
    insertion_order: Vec<String>,
}

/// In-memory broker for moving a tab between windows: the source window
/// stages a JSON snapshot and hands the returned token to the new window,
/// which claims the payload exactly once.
pub struct TabTransferBroker {
    inner: Mutex<BrokerInner>,
    counter: AtomicU64,
}

impl TabTransferBroker {
    pub fn new() -> Self {
        TabTransferBroker {
            inner: Mutex::new(BrokerInner::default()),
            counter: AtomicU64::new(0),
        }
    }

    fn stage(&self, payload: String, source_label: String) -> String {
        let token = format!("t{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        let mut inner = self.inner.lock().unwrap();
        inner.entries.insert(
            token.clone(),
            PendingTransfer {
                payload,
                source_label,
            },
        );
        inner.insertion_order.push(token.clone());
        while inner.entries.len() > MAX_PENDING_TRANSFERS {
            let oldest = inner.insertion_order.remove(0);
            inner.entries.remove(&oldest);
        }
        token
    }

    fn claim(&self, token: &str) -> Option<PendingTransfer> {
        let mut inner = self.inner.lock().unwrap();
        inner.insertion_order.retain(|t| t != token);
        inner.entries.remove(token)
    }

    fn cancel(&self, token: &str) {
        self.claim(token);
    }
}

#[tauri::command]
pub fn stage_detached_tab(
    window: tauri::Window,
    state: State<'_, TabTransferBroker>,
    payload: String,
) -> String {
    state.stage(payload, window.label().to_string())
}

#[tauri::command]
pub fn claim_detached_tab(
    app: AppHandle,
    state: State<'_, TabTransferBroker>,
    token: String,
) -> Option<String> {
    let transfer = state.claim(&token)?;
    let _ = app.emit_to(
        transfer.source_label.as_str(),
        "tab-transfer-claimed",
        token,
    );
    Some(transfer.payload)
}

#[tauri::command]
pub fn cancel_detached_tab(state: State<'_, TabTransferBroker>, token: String) {
    state.cancel(&token);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_then_claim_returns_payload_and_removes_entry() {
        let broker = TabTransferBroker::new();
        let token = broker.stage("{\"tab\":1}".to_string(), "main".to_string());

        let transfer = broker.claim(&token).expect("staged transfer should exist");
        assert_eq!(transfer.payload, "{\"tab\":1}");
        assert_eq!(transfer.source_label, "main");

        assert!(broker.claim(&token).is_none());
    }

    #[test]
    fn cancel_then_claim_returns_none() {
        let broker = TabTransferBroker::new();
        let token = broker.stage("{}".to_string(), "window-1".to_string());

        broker.cancel(&token);
        assert!(broker.claim(&token).is_none());
    }

    #[test]
    fn tokens_are_unique_across_stages() {
        let broker = TabTransferBroker::new();
        let first = broker.stage("a".to_string(), "main".to_string());
        let second = broker.stage("b".to_string(), "main".to_string());
        assert_ne!(first, second);
    }

    #[test]
    fn staging_beyond_cap_evicts_oldest() {
        let broker = TabTransferBroker::new();
        let mut tokens = Vec::new();
        for i in 0..=MAX_PENDING_TRANSFERS {
            tokens.push(broker.stage(format!("payload-{}", i), "main".to_string()));
        }

        // The very first entry was evicted; every later one is still claimable.
        assert!(broker.claim(&tokens[0]).is_none());
        for (i, token) in tokens.iter().enumerate().skip(1) {
            let transfer = broker.claim(token).expect("entry within cap should remain");
            assert_eq!(transfer.payload, format!("payload-{}", i));
        }
    }
}
