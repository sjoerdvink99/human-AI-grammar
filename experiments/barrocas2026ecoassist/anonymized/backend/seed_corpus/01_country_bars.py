# Bar chart with long overlapping category names
import matplotlib.pyplot as plt
countries = ["United States of America", "United Kingdom", "Federal Republic of Germany",
             "French Republic", "Kingdom of the Netherlands", "Kingdom of Belgium",
             "Swiss Confederation", "Republic of Austria", "Kingdom of Denmark", "Republic of Finland"]
values = [331, 67, 83, 68, 17.5, 11.6, 8.7, 9.0, 5.9, 5.5]
fig, ax = plt.subplots(figsize=(6, 4))
ax.bar(countries, values, color="steelblue")
ax.set_title("Population (millions)")
ax.set_ylabel("Millions")
