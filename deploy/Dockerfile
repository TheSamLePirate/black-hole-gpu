# The site on the dedicated server (docs/DEPLOY.md): the CI's assembled Pages site (main at the root,
# the preview under /test/) in nginx. Built by .github/workflows/pages.yml from the site artifact,
# with _site/ extracted beside deploy/.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY _site /usr/share/nginx/html
