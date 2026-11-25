# PATIENT 2.0 native mobile preview

Native React Native + TypeScript screens; no legacy WebView. Connect only to a trusted HTTPS PATIENT v2 test deployment. Configure EXPO_PUBLIC_PATIENT_API_URL in a local .env (public server URL only, never keys or passwords). If no URL is configured, the app explicitly disables login. The v2 server must use the staging database, its publishable key server-side, and APP_ORIGIN matching the HTTPS public origin. Use synthetic accounts only. Do not point at the legacy website or production database.

Implemented: role-specific native login, temporary in-memory sessions with expiry, patient doctor/center directory, paging and search within loaded results, doctor hours, center doctors/hours, own appointment history and provider/admin read-only workspaces. Login sends the configured origin header; the server must still authenticate and authorize every request. Production-grade device sessions, secure transport/deployment, integration testing, feature parity, bookings and other writes, native release builds remain outstanding. No original records were copied or migrated.

To test: install SDK-compatible dependencies with npm install and npx expo install --check, configure the approved HTTPS test server URL, and restart Expo Go using the working LAN/tunnel mode. No production deployment or store submission.
