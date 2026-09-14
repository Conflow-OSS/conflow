-- Runs once, only against a fresh (empty) data volume — see docker-compose.yml.
-- Gives the test suite its own database in the same container, so tests never
-- touch the dev database and vice versa.
CREATE DATABASE content_engine_test;
