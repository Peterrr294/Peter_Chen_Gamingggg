# Knowledge Base Documentation Rules

## Principles

- Keep durable concepts in topic folders and date-specific decisions in `docs/logs/`.
- Preserve technical READMEs beside code when the two change together.
- Retain historical design changes; connect stages with links instead of flattening them into one timeless account.
- Keep English as the primary documentation language while preserving meaningful Chinese explanations and source comments.

## Naming and Titles

- Use short, stable, lowercase filenames with hyphens.
- Give every Markdown document exactly one descriptive level-one heading.
- Keep `YYYY-MM-DD.md` filenames for development logs and add the day's concrete outcome to the heading.
- Avoid generic headings such as “Project Notes,” “Tutorial,” or “Learning Log” without a distinguishing subject or result.

## Linking

- Prefer relative Markdown links so GitHub, Obsidian, and local editors resolve the same target.
- Update inbound links whenever a document moves.
- Link project indexes to code-adjacent technical READMEs rather than duplicating their contents.
- Do not add generated files, dependencies, editor state, or `sources/` content to the curated knowledge base.

## Review Checklist

- [ ] One unique level-one heading exists.
- [ ] The path matches the document's primary subject.
- [ ] Relative links resolve to existing files.
- [ ] Historical facts and verification limits remain intact.
- [ ] No empty headings or placeholder claims were introduced.
- [ ] The Files & Notes page includes the document in the correct category.
