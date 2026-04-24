ALTER TABLE public.entities
  DROP CONSTRAINT IF EXISTS entities_type_check;

ALTER TABLE public.entities
  ADD CONSTRAINT entities_type_check CHECK (type IN (
    'person',
    'organization',
    'brand',
    'category',
    'sub_category',
    'sku',
    'retailer',
    'metric',
    'deliverable',
    'question',
    'meeting',
    'email',
    'document',
    'region',
    'location',
    'event',
    'channel'
  ));
