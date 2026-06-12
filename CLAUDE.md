# Deployment Notes

- Deploy dashboard changes by pushing from the local checkout, then pulling on the homeserver checkout:
  - `git push`
  - `ssh root@homeserver.local`
  - `cd /DATA/AppData/homedashboard/app/nanopi2-dashboard`
  - `git pull`
  - `docker restart homedashboard`
- Verify after restart:
  - `docker inspect homedashboard --format 'Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}'`
  - `curl -sS http://127.0.0.1:8090/health/ready`
  - `curl -sS http://127.0.0.1:8090/api/state | jq '{radar:.radar}'`
- Do not run `npm install` on the homeserver for normal deploys. The dashboard no longer needs native Node image dependencies for radar GIF rendering; it uses the container's `ffmpeg`.
