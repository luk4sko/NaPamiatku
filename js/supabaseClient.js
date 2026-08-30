// Pripojenie k Supabase. Publishable ("anon") kľúč je bezpečné mať vo frontend kóde -
// slúži len na verejné/RLS-riadené operácie, nie je to tajný kľúč.
const SUPABASE_URL = "https://iaaaeplkexaqzjrfdzwc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EckH1BO5EpQN8GQLZ4AqCQ_hcv6EtvU";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
