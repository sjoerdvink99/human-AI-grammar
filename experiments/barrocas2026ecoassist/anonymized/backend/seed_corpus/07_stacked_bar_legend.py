# Stacked bar chart with legend in the upper left over the bars
import matplotlib.pyplot as plt
import numpy as np
years = ["2019", "2020", "2021", "2022", "2023"]
a = np.array([20, 25, 30, 35, 40])
b = np.array([15, 18, 22, 25, 30])
c = np.array([10, 12, 15, 18, 25])
fig, ax = plt.subplots(figsize=(5, 4))
ax.bar(years, a, label="Product A")
ax.bar(years, b, bottom=a, label="Product B")
ax.bar(years, c, bottom=a + b, label="Product C")
ax.legend(loc="upper left")
ax.set_title("Revenue by product")
ax.set_xlabel("Year")
ax.set_ylabel("Revenue (M$)")
