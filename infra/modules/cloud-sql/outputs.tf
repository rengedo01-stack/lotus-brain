output "instance_name" {
  value = google_sql_database_instance.production.name
}

output "connection_name" {
  value = google_sql_database_instance.production.connection_name
}

output "private_ip_address" {
  value = google_sql_database_instance.production.private_ip_address
}

output "database_name" {
  value = google_sql_database.application.name
}
