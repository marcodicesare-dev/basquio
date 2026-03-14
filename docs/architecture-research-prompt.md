# Canonical Research Prompt

Use this prompt when asking another agent to research the right end-to-end Basquio architecture.

## Prompt

You are doing deep technical research for Basquio, a system that must generate executive-grade PPTX and PDF reports from:

1. a multi-file evidence package, usually CSV/XLS/XLSX plus support docs
2. a design target, usually a PPTX template, token file, or style reference
3. a knowledge brief with audience, objective, thesis, stakes, and business context

This is not a generic deck generator.

The real requirement is:

- no hard-coded case-by-case mapping
- no filename-specific logic pretending to be intelligence
- AI should interpret the package and understand the data map
- code should compute the numbers deterministically
- different AIs should own different jobs instead of saying the same thing twice
- the design target must materially affect the output deck
- large and ambiguous decks should be allowed to think longer and revise more than small simple decks

Think about this like a team of specialist analysts and report strategists.

If I handed you:

- 10 source files
- a knowledge brief
- a target output deck style such as the SGS sustainability AI visibility deck

what exact steps would you take to produce the final report?

Those are the steps you need to research and formalize into the best implementation architecture possible.

Spend as long as needed. Ten minutes, thirty minutes, or an hour is fine. Optimize for correctness and implementation realism, not speed.

Use primary sources only.

Repo context:

- Workspace: `/Users/marcodicesare/Documents/Projects/basquio`
- Existing stack: Inngest, Supabase, SheetJS, PptxGenJS, Browserless, Vercel AI SDK
- Current weakness: the repo has some staged structure, but it is still too heuristic and not yet truly AI-native in package understanding, metric planning, slide architecture, template handling, and critic loops

Research and deliver:

1. The best multi-agent architecture for report generation from evidence packages
2. The exact separation of responsibilities between:
   - package semantics inference
   - metric planning
   - deterministic analytics execution
   - insight ranking
   - narrative planning
   - slide planning
   - template/design translation
   - critic/reviewer validation
3. The best way to make PPTX template input truly first-class, including layout and placeholder constraints
4. The best way for AI to understand multiple related files without hard-coded filename mapping
5. The best orchestration model for long-running large-deck generation with retries, loops, checkpoints, and auditability
6. The best evaluation framework for a canonical case:
   - 10 SGS sustainability AI visibility source files in
   - branded SGS AI visibility deck out
7. Exact recommendations for:
   - model assignment by stage
   - prompt contracts by stage
   - typed schemas by stage
   - orchestration loop design
   - critic and cross-model validation design
   - observability, tracing, and prompt/model versioning
   - failure handling and retry strategy
8. What the current Basquio code is still getting wrong conceptually, even if it typechecks

Required output:

- a proposed target architecture
- a stage-by-stage orchestration plan
- a concrete agent-roles map
- a contract and schema map
- a validation and evals plan
- a phased implementation roadmap
- a list of anti-patterns to avoid
- a blunt gap analysis explaining why current systems fail at this problem

Important constraints:

- no hard-coded case-by-case data mapping
- AI should interpret the package; code should compute the numbers
- different AIs should not just restate the same task
- there must be an independent critic or reviewer stage
- the design input must materially affect the final artifact
- bigger decks should take longer and think harder than smaller ones
- recommendations and narrative claims must be traceable back to deterministic evidence
