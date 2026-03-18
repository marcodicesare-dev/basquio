-- Chart semantic fields from the design system
ALTER TABLE public.deck_spec_v2_charts ADD COLUMN IF NOT EXISTS intent text;
ALTER TABLE public.deck_spec_v2_charts ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.deck_spec_v2_charts ADD COLUMN IF NOT EXISTS benchmark_label text;
ALTER TABLE public.deck_spec_v2_charts ADD COLUMN IF NOT EXISTS benchmark_value numeric;
ALTER TABLE public.deck_spec_v2_charts ADD COLUMN IF NOT EXISTS source_note text;
