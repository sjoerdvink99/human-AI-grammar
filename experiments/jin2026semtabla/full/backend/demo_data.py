"""Deterministic demo database with a few planted data-quality problems so that
sample-based detection produces counterexamples on the full data."""
from __future__ import annotations

import random
from datetime import date, timedelta

import pandas as pd

FIRST = ["Ana", "Ben", "Chen", "Dara", "Eli", "Fatima", "Goran", "Hana", "Ivo", "Jun", "Kai", "Lena",
         "Mo", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sven", "Tara", "Uma", "Vik", "Wen", "Yara", "Zoe"]
LAST = ["Smith", "Garcia", "Kim", "Novak", "Okafor", "Jansen", "Rossi", "Silva", "Tanaka", "Muller",
        "Haddad", "Larsen", "Kowalski", "Nguyen", "Dubois"]
CITIES = [("1011", "Amsterdam", "NL"), ("3011", "Rotterdam", "NL"), ("10115", "Berlin", "DE"),
          ("80331", "Munich", "DE"), ("75001", "Paris", "FR"), ("69001", "Lyon", "FR"),
          ("28001", "Madrid", "ES"), ("08001", "Barcelona", "ES"), ("00118", "Rome", "IT"),
          ("1000", "Brussels", "BE")]
COUNTRIES = [("NL", "Netherlands", "EUR"), ("DE", "Germany", "EUR"), ("FR", "France", "EUR"),
             ("ES", "Spain", "EUR"), ("IT", "Italy", "EUR"), ("BE", "Belgium", "EUR"),
             ("GB", "United Kingdom", "GBP"), ("CH", "Switzerland", "CHF")]
CATEGORIES = [(1, "Books"), (2, "Electronics"), (3, "Garden"), (4, "Kitchen"), (5, "Toys"), (6, "Sports")]
STORES = [(1, "Amsterdam"), (2, "Berlin"), (3, "Paris"), (4, "Madrid"), (5, "Rome")]


def build_demo() -> dict[str, pd.DataFrame]:
    rng = random.Random(7)

    countries = pd.DataFrame(COUNTRIES, columns=["country_code", "country_name", "currency"])
    categories = pd.DataFrame(CATEGORIES, columns=["category_id", "category_name"])

    customers = []
    for i in range(1, 151):
        fn, ln = rng.choice(FIRST), rng.choice(LAST)
        zip_code, city, cc = rng.choice(CITIES)
        customers.append({
            "customer_id": i,
            "first_name": fn,
            "last_name": ln,
            "email": f"{fn.lower()}.{ln.lower()}{i}@example.com",
            "phone": f"+31 6 {rng.randint(10000000, 99999999)}",
            "zip_code": zip_code,
            "city": city,
            "country_code": cc,
            "signup_date": (date(2021, 1, 1) + timedelta(days=rng.randint(0, 900))).isoformat(),
            "is_active": rng.random() > 0.2,
        })
    customers = pd.DataFrame(customers)
    customers.loc[41, "email"] = customers.loc[40, "email"]  # duplicate email

    products = []
    for i in range(1, 41):
        cat = rng.choice(CATEGORIES)
        products.append({
            "product_id": i,
            "sku": f"SKU-{cat[0]:02d}-{1000 + i}",
            "product_name": f"{cat[1]} item {i}",
            "category_id": cat[0],
            "unit_price": round(rng.uniform(3, 400), 2),
            "weight_kg": round(rng.uniform(0.1, 12), 2),
            "description": rng.choice([
                "Durable and lightweight, ideal for everyday use.",
                "A customer favourite with a two-year warranty.",
                "Limited edition, available while stocks last.",
                "Eco-friendly materials and recyclable packaging.",
            ]),
        })
    products = pd.DataFrame(products)

    orders = []
    for i in range(1, 2501):
        store_id, store_city = rng.choice(STORES)
        orders.append({
            "order_id": 100000 + i,
            "order_ref": f"ORD-{rng.randint(10**7, 10**8 - 1)}",
            "customer_id": rng.randint(1, 150),
            "store_id": store_id,
            "store_city": store_city,
            "order_date": (date(2023, 1, 1) + timedelta(days=rng.randint(0, 600))).isoformat(),
            "status": rng.choice(["NEW", "PAID", "SHIPPED", "DELIVERED", "RETURNED"]),
            "discount_pct": rng.choice([0, 0, 0, 5, 10, 15]),
            "total_amount": 0.0,
        })
    orders = pd.DataFrame(orders)
    # planted problems (rare, so a 200-row sample usually misses them)
    orders.loc[1500, "order_ref"] = orders.loc[20, "order_ref"]
    orders.loc[[333, 1777, 2222], "customer_id"] = [9001, 9002, 9003]  # orphan customers
    orders.loc[901, "store_city"] = "Amsterdm"  # breaks store_id -> store_city
    orders["discount_pct"] = orders["discount_pct"].astype("float")
    orders.loc[[77, 1234, 2001, 2400], "discount_pct"] = None

    items = []
    for oid in orders["order_id"]:
        for line in range(1, rng.randint(1, 4) + 1):
            p = products.iloc[rng.randint(0, len(products) - 1)]
            items.append({
                "order_id": int(oid),
                "line_no": line,
                "product_id": int(p.product_id),
                "quantity": rng.randint(1, 5),
                "unit_price": float(p.unit_price),
            })
    items = pd.DataFrame(items)
    items.loc[[500, 3100], "product_id"] = [77, 78]  # orphan products
    totals = (items.quantity * items.unit_price).groupby(items.order_id).sum().round(2)
    orders["total_amount"] = orders["order_id"].map(totals).fillna(0.0)

    return {
        "countries": countries,
        "categories": categories,
        "customers": customers,
        "products": products,
        "orders": orders,
        "order_items": items,
    }
