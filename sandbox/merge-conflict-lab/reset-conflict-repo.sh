#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
repo_dir="$script_dir/repo"

write_adjacent_story_conflicts() {
cat <<'EOF' > story.txt
Release Notes
=============

<<<<<<< HEAD
Headline: Main branch rewrite
=======
Headline: Feature branch rewrite
>>>>>>> feature/conflicting-copy
<<<<<<< HEAD
Status: blocked-by-review
=======
Status: ready-for-review
>>>>>>> feature/conflicting-copy
<<<<<<< HEAD
Owner: core-team
=======
Owner: feature-team
>>>>>>> feature/conflicting-copy
EOF
}

rm -rf "$repo_dir"
mkdir -p "$repo_dir"

cd "$repo_dir"

git init -b main >/dev/null
git config user.name "Gitvan Conflict Lab"
git config user.email "conflict-lab@example.com"

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Shared baseline text
Status: pending
Owner: product-team
EOF

cat <<'EOF' > config.json
{
    "environment": "shared",
    "apiBaseUrl": "https://shared.example.test",
    "featureFlag": false
}
EOF

cat <<'EOF' > notes.md
# Deployment Checklist

- Verify migrations
- Notify QA
- Prepare release notes
EOF

cat <<'EOF' > unchanged-one.txt
This file is intentionally left unchanged.
EOF

cat <<'EOF' > unchanged-two.txt
This file also stays unchanged across all branches.
EOF

cat <<'EOF' > feature-only.txt
Feature-only notes
==================

Status: baseline
Owner: shared
EOF

cat <<'EOF' > main-only.txt
Main-only notes
===============

Status: baseline
Owner: shared
EOF

git add story.txt config.json notes.md unchanged-one.txt unchanged-two.txt feature-only.txt main-only.txt
git commit -m "Initial baseline" >/dev/null

git switch -c feature/conflicting-copy >/dev/null

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Feature branch rewrite
Status: ready-for-review
Owner: feature-team
EOF

cat <<'EOF' > config.json
{
    "environment": "feature-branch",
    "apiBaseUrl": "https://feature.example.test",
    "featureFlag": true
}
EOF

cat <<'EOF' > notes.md
# Deployment Checklist

- Verify migrations
- Notify support
- Prepare feature announcement
EOF

cat <<'EOF' > feature-only.txt
Feature-only notes
==================

Status: updated-on-feature
Owner: feature-team
EOF

cat <<'EOF' > main-only.txt
Main-only notes
===============

Status: updated-on-feature
Owner: release-team
EOF

git add story.txt config.json notes.md feature-only.txt main-only.txt
git commit -m "Feature branch edits conflicting and clean files" >/dev/null

git switch main >/dev/null

cat <<'EOF' > story.txt
Release Notes
=============

Headline: Main branch rewrite
Status: blocked-by-review
Owner: core-team
EOF

cat <<'EOF' > config.json
{
    "environment": "main-branch",
    "apiBaseUrl": "https://main.example.test",
    "featureFlag": false
}
EOF

cat <<'EOF' > notes.md
# Deployment Checklist

- Verify database backup
- Notify QA
- Prepare production summary
EOF

git add story.txt config.json notes.md
git commit -m "Main branch edits conflicting and clean files" >/dev/null

set +e
git merge feature/conflicting-copy >/tmp/gitvan-conflict-merge.log 2>&1
merge_exit=$?
set -e

if [[ $merge_exit -eq 0 ]]; then
    echo "Expected a merge conflict, but merge completed cleanly." >&2
    exit 1
fi

# Keep the index unmerged, but rewrite the working tree copy so one file has
# adjacent conflict blocks with no unchanged lines between them.
write_adjacent_story_conflicts

echo "Dummy repository created at: $repo_dir"
echo "Repository is intentionally left in a merge-conflict state."
echo "Conflicted files: story.txt, config.json, notes.md"
echo "story.txt contains adjacent conflict blocks with no unchanged lines between them"
echo "Changed without conflict: feature-only.txt, main-only.txt"
echo "Unchanged files: unchanged-one.txt, unchanged-two.txt"