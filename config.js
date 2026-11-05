/* Публичные настройки Supabase. Anon/publishable-ключ можно хранить в открытом коде:
   доступ к данным ограничен правилами RLS в базе (supabase/migrations). */
window.SVITOK_CONFIG = {
  supabaseUrl: 'https://mkermmysumhnwsrndlio.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rZXJtbXlzdW1obndzcm5kbGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NzA4MzEsImV4cCI6MjEwOTQ0NjgzMX0.iCLRDjQjtGaB6PQGetZLbyZn-U8v0-mfWOAxhe4CkSg',
  telegramBot: 'svitok_login_bot',
  // Вход по почте включим после подключения своей почты (SMTP): на бесплатном тарифе
  // Supabase нельзя поменять письмо так, чтобы в нём был код вместо ссылки.
  emailLogin: false,
};
