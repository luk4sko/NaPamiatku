// Pripojenie k Supabase. Publishable ("anon") kľúč je bezpečné mať vo frontend kóde -
// slúži len na verejné/RLS-riadené operácie, nie je to tajný kľúč.
const SUPABASE_URL = "https://api.napamiatku.com";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xqaE4iJhnBVVN5wvQjPgNB_14EPIVth";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
