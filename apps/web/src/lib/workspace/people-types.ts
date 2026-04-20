export type StakeholderPreferences = {
  free_text?: string;
  structured?: {
    chart_preference?: string;
    deck_length?: string;
    language?: string;
    tone?: string;
    review_day?: string;
    [k: string]: unknown;
  };
};

export type PersonRow = {
  id: string;
  workspace_id: string;
  type: "person";
  canonical_name: string;
  normalized_name: string;
  aliases: string[];
  metadata: {
    role?: string;
    company?: string;
    description?: string;
    linked_scope_id?: string;
    preferences?: StakeholderPreferences;
    notes?: string;
    [k: string]: unknown;
  };
  created_at: string;
  updated_at: string;
};

export type PersonMention = {
  id: string;
  source_type: "document" | "transcript" | "chunk";
  source_id: string;
  excerpt: string | null;
  created_at: string;
  document_filename: string | null;
};

export type PersonFact = {
  id: string;
  predicate: string;
  object_value: unknown;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  evidence: string | null;
  source_id: string | null;
  document_filename: string | null;
};

export type PersonDeliverable = {
  id: string;
  title: string;
  kind: string;
  status: string;
  scope: string | null;
  created_at: string;
};

export type PersonProfile = PersonRow & {
  mentions: PersonMention[];
  facts: PersonFact[];
  deliverables: PersonDeliverable[];
};
