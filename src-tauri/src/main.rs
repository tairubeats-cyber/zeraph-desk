#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mail;
mod privacy;
mod simplefin;

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create core tables",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add message_id for reply threading",
            sql: include_str!("../migrations/002_message_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "finance categories and transaction overrides",
            sql: include_str!("../migrations/003_finance.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "finance budgets, goals and recurring marks",
            sql: include_str!("../migrations/004_money_management.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "finance insight state",
            sql: include_str!("../migrations/005_intelligence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "finance planning: debt terms, holdings, planned items, scenarios",
            sql: include_str!("../migrations/006_planning.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "finance imported data and notification tracking",
            sql: include_str!("../migrations/007_import.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "finance synced accounts and sync history",
            sql: include_str!("../migrations/008_sync.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:zeraph.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            mail::mail_connect,
            mail::mail_is_connected,
            mail::mail_pull,
            mail::mail_send,
            mail::mail_forget,
            privacy::save_export,
            privacy::data_info,
            simplefin::simplefin_claim,
            simplefin::simplefin_connected,
            simplefin::simplefin_disconnect,
            simplefin::simplefin_accounts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zeraph Desk");
}
