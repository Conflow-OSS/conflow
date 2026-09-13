# stories/

Long stories / case studies for the matrix flow's `--story-file` input.
One story per file, plain text or Markdown.

```sh
npm run dev -- generate --flow matrix --story-file stories/mine.md
```

The model pulls `GEN_X` topics out of the story, then each topic becomes
`GEN_Y` angles and each angle `GEN_Z` posts (`GEN_X × GEN_Y × GEN_Z` posts).
Set `GEN_X` / `GEN_Y` / `GEN_Z` in `.env`.

Your own stories are yours to keep or commit.
