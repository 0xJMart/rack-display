FROM nginxinc/nginx-unprivileged:1.30-alpine
ENV PROMETHEUS_URL=http://prometheus-stack-kube-prom-prometheus.monitoring.svc:9090 \
    ALERTMANAGER_URL=http://prometheus-stack-kube-prom-alertmanager.monitoring.svc:9093
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
