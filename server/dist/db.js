import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
// Service role client — bypasses RLS for backend operations
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
