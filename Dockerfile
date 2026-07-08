# 과학상자 조립 시뮬레이터 — 정적 서빙 (빌드 단계 불필요)
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY data /usr/share/nginx/html/data
EXPOSE 80
