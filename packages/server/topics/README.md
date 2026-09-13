# topics/

Plain-text topic lists for the matrix flow — one topic per line, `#` for
comments, blank lines ignored.

```sh
cp topics/example.txt topics/mine.txt
# edit topics/mine.txt
npm run dev -- generate --flow matrix --topics-file topics/mine.txt
```

Each topic becomes `GEN_Y` angles, and each angle becomes `GEN_Z` posts
(so `topics × GEN_Y × GEN_Z` posts in total). Set `GEN_Y` / `GEN_Z` in `.env`.

Your own lists (`mine.txt`, etc.) are yours to keep or commit — only `example.txt`
is tracked by default.
