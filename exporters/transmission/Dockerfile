FROM python:3.13-alpine
COPY exporter.py /exporter.py
USER 65534
EXPOSE 19091
ENTRYPOINT ["python3", "-u", "/exporter.py"]
