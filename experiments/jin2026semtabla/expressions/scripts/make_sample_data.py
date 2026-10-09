"""Generate a small, deterministic e-commerce 'data lake' used as demo input (tables_1).

A few dirty values are planted on purpose so that the sampling loop of process 1
finds counterexamples in the full tables that were not visible in the first sample.
"""
import csv
import os
import random
from datetime import date, timedelta

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "sample")
rng = random.Random(7)

FIRST = ["Anna", "Bram", "Chloe", "Daan", "Eva", "Finn", "Gwen", "Hugo", "Iris", "Jens",
         "Kim", "Lars", "Mila", "Noah", "Olga", "Piet", "Quinn", "Rosa", "Sven", "Tess"]
LAST = ["de Vries", "Jansen", "Bakker", "Visser", "Smit", "Meijer", "Mulder", "Bos", "Vos", "Peters"]
COUNTRIES = [("NL", "Netherlands", "EUR"), ("DE", "Germany", "EUR"), ("BE", "Belgium", "EUR"),
             ("FR", "France", "EUR"), ("GB", "United Kingdom", "GBP"), ("US", "United States", "USD"),
             ("SE", "Sweden", "SEK"), ("DK", "Denmark", "DKK"), ("ES", "Spain", "EUR"), ("IT", "Italy", "EUR")]
CITIES = {"NL": ["Amsterdam", "Utrecht", "Rotterdam"], "DE": ["Berlin", "Munich"], "BE": ["Brussels", "Ghent"],
          "FR": ["Paris", "Lyon"], "GB": ["London", "Leeds"], "US": ["Boston", "Austin"],
          "SE": ["Stockholm"], "DK": ["Copenhagen"], "ES": ["Madrid"], "IT": ["Rome", "Milan"]}
CATEGORIES = [(1, "Books", "Printed and digital books"), (2, "Garden", "Tools and plants"),
              (3, "Kitchen", "Cookware and utensils"), (4, "Toys", "Games and toys"),
              (5, "Audio", "Headphones and speakers"), (6, "Sports", "Sports equipment")]
STATUSES = ["placed", "paid", "shipped", "delivered", "returned"]


def write(name, header, rows):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    write("countries", ["country_code", "country_name", "currency"], COUNTRIES)
    write("categories", ["category_id", "category_name", "description"], CATEGORIES)

    customers = []
    for cid in range(1, 301):
        fn, ln = rng.choice(FIRST), rng.choice(LAST)
        cc = rng.choice(COUNTRIES)[0]
        email = f"{fn.lower()}.{ln.lower().replace(' ', '')}{cid}@example.com"
        signup = date(2021, 1, 1) + timedelta(days=rng.randint(0, 1200))
        customers.append([cid, f"{fn} {ln}", email, rng.choice(CITIES[cc]), cc, signup.isoformat()])
    # planted dirt: two malformed e-mails and one missing city
    customers[211][2] = "noemail"
    customers[287][2] = "jens.bos(at)example.com"
    customers[150][3] = ""
    write("customers", ["customer_id", "full_name", "email", "city", "country_code", "signup_date"], customers)

    products = []
    for pid in range(1, 61):
        cat = rng.choice(CATEGORIES)
        price = round(rng.uniform(4, 120), 2)
        products.append([pid, f"SKU-{1000 + pid}", f"{cat[1]} item {pid}", cat[0], price])
    products[44][4] = 1299.00  # planted outlier price
    write("products", ["product_id", "sku", "product_name", "category_id", "unit_price"], products)

    orders, items = [], []
    item_id = 1
    for oid in range(1, 901):
        cust = rng.choice(customers)
        odate = date(2023, 1, 1) + timedelta(days=rng.randint(0, 600))
        status = rng.choices(STATUSES, weights=[1, 2, 3, 8, 1])[0]
        total = 0.0
        for _ in range(rng.randint(1, 4)):
            p = rng.choice(products)
            qty = rng.randint(1, 5)
            total += qty * p[4]
            items.append([item_id, oid, p[0], qty, p[4]])
            item_id += 1
        orders.append([oid, cust[0], odate.isoformat(), status, round(total, 2), cust[4]])
    orders[613][3] = "lost"  # planted status outside the usual domain
    write("orders", ["order_id", "customer_id", "order_date", "status", "order_total", "ship_country"], orders)
    write("order_items", ["order_item_id", "order_id", "product_id", "quantity", "unit_price"], items)
    print(f"wrote sample data to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
