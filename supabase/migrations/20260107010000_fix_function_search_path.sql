-- Fix mutable search_path on functions
-- Flagged by Supabase security linter. Setting search_path = '' prevents
-- potential search_path hijacking attacks.

ALTER FUNCTION public.log_events SET search_path = '';
ALTER FUNCTION public.get_public_list SET search_path = '';
ALTER FUNCTION public.submit_flag SET search_path = '';
ALTER FUNCTION public.get_visitor_flag_count SET search_path = '';
ALTER FUNCTION public.log_visit SET search_path = '';
ALTER FUNCTION public.get_visitor_stats SET search_path = '';
ALTER FUNCTION public.update_updated_at SET search_path = '';
