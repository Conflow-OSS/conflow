# The night GitLab lost six hours of production data

On 31 January 2017, GitLab.com went down for roughly 18 hours and permanently lost about
six hours of database changes — around 5,000 projects, 5,000 comments and 700 new user
accounts. Git repositories and wikis were untouched, but everything in the primary Postgres
database written between 17:20 and 23:30 UTC was gone. What made the incident famous was not
the mistake itself but everything that failed to catch it.

## How it started

Earlier that evening the database was under heavy load, partly from spam and abuse traffic.
Replication to the secondary database fell behind and then stopped. An engineer working late
tried to rebuild the secondary from scratch. Because the primary and secondary servers looked
almost identical in the terminal, he ran `rm -rf` on the data directory of the wrong host —
the live primary. He noticed and cancelled the command within a couple of seconds, but by
then only about 4.5 GB of a roughly 300 GB database remained.

## The five safeguards that should have saved them

The team then discovered, one by one, that every layer of protection they thought they had
was broken:

- The nightly `pg_dump` logical backups had been silently failing for a long time. A version
  mismatch between client and server made `pg_dump` exit without producing a usable dump, and
  the cron failure emails were being rejected by the receiving mail server's DMARC policy, so
  nobody saw the alerts.
- The secondary database — the thing you fail over to — was the very system that had fallen
  out of sync that day. Its write-ahead logs had already been cleaned up, so it could not be
  used to roll forward.
- Azure disk snapshots were enabled on the file servers but not on the database servers, and
  the team believed otherwise. Even where snapshots did exist, restoring one took more than
  18 hours because of slow disk throughput.
- Backups were also meant to be copied to object storage, but that bucket turned out to be
  empty.
- There was no confirmation step, no protected-host check, nothing at all standing between an
  engineer with production access and a destructive command.

## How they recovered

The only usable copy was a six-hour-old snapshot that an engineer had taken by hand earlier
that day, for an unrelated staging test. It was luck, not process. Restoring from it, plus
transferring the data across environments over a slow link, is what pushed the outage past
18 hours. GitLab ran the entire recovery on a public YouTube livestream and a shared Google
Doc, narrating each step as it happened, and published a detailed blameless postmortem ten
days later.

## What they changed afterwards

The action items were mostly unglamorous operational work: make backups actually run and
alert loudly when they do not, test restores on a schedule instead of assuming they work,
add a prominent visual difference between production and staging shells, require a
type-the-hostname confirmation for dangerous commands, move snapshots onto the database tier,
and treat "how fast can we restore" as a first-class metric rather than "how often do we back
up". They also assigned a team to own database reliability instead of leaving it as everyone's
and no one's job.

## Why it still gets cited

The technical trigger was a fat-fingered `rm -rf`, which every engineer has felt in their
stomach at least once. But the reason a single command turned into six hours of permanent
data loss was that backups were untested, monitoring was silent, the failover target was
already broken, and recovery speed had never been measured. The mistake was human; the outage
was systemic. GitLab's decision to recover in the open, and to write the whole thing up
without blaming the engineer, is now a standard reference for how to run a postmortem.
