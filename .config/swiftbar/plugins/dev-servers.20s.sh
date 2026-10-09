#!/usr/bin/env bash
# <swiftbar.title>Dev Servers</swiftbar.title>
# <swiftbar.version>1.0</swiftbar.version>
# <swiftbar.author>Eric</swiftbar.author>
# <swiftbar.desc>Shows local dev servers that may keep running in the background.</swiftbar.desc>

set -u

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

rows="$(
  ps -axo pid=,tty=,etime=,pcpu=,command= 2>/dev/null |
    awk '
      {
        cmd=$0
        sub(/^ *[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +/, "", cmd)
      }
      cmd ~ /shopify theme dev|npm run dev|pnpm .* dev|yarn .* dev|vite|next dev|astro dev|remix vite:dev/ &&
      cmd !~ /^awk / &&
      cmd !~ /dev-servers\.20s\.sh/ {
        print
      }
    '
)"
count="$(printf '%s\n' "$rows" | sed '/^$/d' | wc -l | tr -d ' ')"

echo "🚀 ${count}"
echo "---"

if [ "$count" = "0" ]; then
  echo "No dev servers found"
else
  printf '%s\n' "$rows" | while IFS= read -r row; do
    [ -n "$row" ] || continue
    pid="$(printf '%s\n' "$row" | awk '{print $1}')"
    ports="$(lsof -Pan -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {sub(/^.*:/,"",$9); print $9}' | sort -un | paste -sd, -)"
    printf '%s\n' "$row" | awk -v ports="${ports:-none}" '{
      pid=$1; tty=$2; age=$3; cpu=$4;
      $1=$2=$3=$4="";
      sub(/^ +/,"");
      cmd=$0;
      if (length(cmd) > 90) cmd=substr(cmd,1,87) "...";
      printf "%s age=%s cpu=%s%% ports=%s %s\n", pid, age, cpu, ports, cmd
    }'
  done
fi

echo "---"
echo "Refresh | refresh=true"
echo "Open Activity Monitor | bash=/usr/bin/open param1=-a param2=Activity\\ Monitor terminal=false"
