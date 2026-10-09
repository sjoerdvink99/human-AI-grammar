# Multi-line chart with legend covering the data
import matplotlib.pyplot as plt
import numpy as np
x = np.arange(1, 13)
fig, ax = plt.subplots(figsize=(6, 4))
for i, name in enumerate(["North", "South", "East", "West"]):
    ax.plot(x, 50 + 10 * i + 20 * np.sin(x / 2 + i), marker="o", label=name)
ax.legend(loc="center")
ax.set_title("Monthly sales by region")
ax.set_xlabel("Month")
ax.set_ylabel("Sales (k$)")
