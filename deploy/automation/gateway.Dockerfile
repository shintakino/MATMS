FROM cloudflare/cloudflared:2026.10.3
COPY deploy/automation/cloudflared.yml /etc/cloudflared/config.yml
