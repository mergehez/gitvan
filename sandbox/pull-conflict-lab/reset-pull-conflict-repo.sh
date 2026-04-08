#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
origin_dir="$script_dir/origin.git"
repo_dir="$script_dir/repo"
upstream_dir="$script_dir/upstream"

rm -rf "$origin_dir" "$repo_dir" "$upstream_dir"

git init --bare "$origin_dir" >/dev/null
git clone "$origin_dir" "$repo_dir" >/dev/null

cd "$repo_dir"
git config user.name "Gitvan Pull Conflict Lab"
git config user.email "pull-conflict-lab@example.com"

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Shared baseline
Status: pending
Checklist: verify migrations
Footer: internal draft
EOF

cat <<'EOF' > notes.md
# Pull Conflict Lab

- Local changes are intentionally left unstaged.
- Origin has one newer commit.
EOF

git add story.txt notes.md
git commit -m "Initial baseline" >/dev/null
git push -u origin main >/dev/null

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Local branch draft
Status: blocked-by-qa
Checklist: verify migrations and smoke tests
Footer: local branch update
EOF

git add story.txt
git commit -m "Create a local branch commit that will conflict with origin" >/dev/null

cd "$script_dir"
git clone "$origin_dir" "$upstream_dir" >/dev/null

cd "$upstream_dir"
git config user.name "Gitvan Upstream Writer"
git config user.email "upstream@example.com"

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Origin release draft
Status: ready-for-release
Checklist: verify migrations and rollout notes
Footer: upstream release update
EOF

git add story.txt
git commit -m "Advance origin with incoming release update" >/dev/null
git push origin main >/dev/null

cd "$repo_dir"

git fetch origin >/dev/null

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Local working tree draft
Status: blocked-by-qa
Checklist: verify migrations and smoke tests
Footer: local working tree edit
EOF

cat <<'EOF' > notes.md
# Pull Conflict Lab

- Local changes are intentionally left unstaged.
- Origin has one newer commit.
- The current branch also has one local commit that conflicts with origin.
- Use Pull in Gitvan to trigger the stash prompt, then pull into a merge conflict.
EOF

echo "Lab repository created at: $repo_dir"
echo "Origin remote created at: $origin_dir"
echo "The repository has a local commit, is behind origin/main, and has local unstaged changes."
echo "Tracking refs were fetched so Gitvan should show both pull and push indicators."
echo "Test file: story.txt"