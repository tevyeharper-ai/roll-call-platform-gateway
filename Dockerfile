FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && docker-php-ext-install pdo_pgsql \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

RUN printf '<Directory /var/www/html>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-available/forge.conf \
    && a2enconf forge

WORKDIR /var/www/html
COPY . /var/www/html

RUN mkdir -p /var/www/html/forge-app/storage \
    && chown -R www-data:www-data /var/www/html/forge-app/storage \
    && chmod 0775 /var/www/html/forge-app/storage

EXPOSE 80

CMD ["bash", "-lc", "php forge-app/bin/railway-init.php && exec apache2-foreground"]
