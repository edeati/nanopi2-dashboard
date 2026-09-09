FROM alpine:3.22

RUN apk add --no-cache \
      android-tools \
      bash \
      ca-certificates \
      curl \
      jq

COPY scripts/monitor-fully-kiosk.sh /usr/local/bin/monitor-fully-kiosk
COPY scripts/healthcheck-fully-kiosk.sh /usr/local/bin/healthcheck-fully-kiosk
RUN chmod 0755 /usr/local/bin/monitor-fully-kiosk /usr/local/bin/healthcheck-fully-kiosk

ENV FULLY_KIOSK_MONITOR_ROOT=/var/lib/fully-kiosk-monitor

HEALTHCHECK --interval=15s --timeout=8s --start-period=20s --retries=3 \
  CMD ["/usr/local/bin/healthcheck-fully-kiosk"]

ENTRYPOINT ["/usr/local/bin/monitor-fully-kiosk"]
