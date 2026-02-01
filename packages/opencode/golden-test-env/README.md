# Golden Context Repository

This directory serves as the isolated environment for the A1P0 Benchmarking Suite.

## Structure
- `stable/`: Contains immutable files used for read verifications.
  - `hello.txt`: Simple text file for `read_file` tests.
- `scratch/`: Intended for mutation tests (create/delete). The test runner uses a temporary copy of this repo, so changes here are ephemeral.

## A1P0 Philosophy
"It's a mixmashmush of questionable meat, spewed with consistency!"