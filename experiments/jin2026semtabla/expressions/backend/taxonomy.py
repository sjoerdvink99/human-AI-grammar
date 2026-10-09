"""Fixed category sets for the categorical labels in the design."""

# rule_taxonomies / predicted_taxonomies / column_semantics.semantic_type
SEMANTIC_TYPES = [
    "identifier", "person_name", "entity_name", "email", "phone", "url", "address", "city",
    "country", "country_code", "currency_code", "postal_code", "date", "datetime", "year",
    "currency_amount", "quantity", "percentage", "measure", "latitude", "longitude",
    "category", "status", "boolean", "code", "description", "unknown",
]

SEMANTIC_TYPE_HELP = {
    "identifier": "surrogate or natural key identifying a row or referencing one",
    "person_name": "name of a person", "entity_name": "name of a non-person thing (product, company, category)",
    "email": "e-mail address", "phone": "phone number", "url": "web address", "address": "street address",
    "city": "city name", "country": "country name", "country_code": "ISO country code",
    "currency_code": "ISO currency code", "postal_code": "postal / zip code",
    "date": "calendar date", "datetime": "timestamp", "year": "calendar year",
    "currency_amount": "monetary value", "quantity": "count of items", "percentage": "ratio or percent",
    "measure": "other numeric measurement", "latitude": "latitude", "longitude": "longitude",
    "category": "low-cardinality categorical value", "status": "lifecycle state of a record",
    "boolean": "two-valued flag", "code": "structured code such as a SKU", "description": "free text",
    "unknown": "none of the above",
}

# table_labels / table_types / refined_* / table_types_2
TABLE_TYPES = ["fact", "dimension", "bridge", "lookup", "event_log", "other"]

TABLE_TYPE_HELP = {
    "fact": "records transactions/measurements; references several dimensions and carries numeric measures",
    "dimension": "describes entities (customers, products) referenced by facts",
    "bridge": "associates two or more entities (many-to-many), little else",
    "lookup": "small code list mapping codes to names",
    "event_log": "time-stamped events or state changes of an entity",
    "other": "does not fit the types above",
}

# table-level features used by the table classifier (process 5)
TABLE_FEATURES = [
    "n_rows", "n_columns", "n_fk_out", "n_referenced_by", "has_primary_key",
    "frac_identifier", "frac_numeric_measure", "frac_categorical", "frac_text", "frac_temporal",
]
