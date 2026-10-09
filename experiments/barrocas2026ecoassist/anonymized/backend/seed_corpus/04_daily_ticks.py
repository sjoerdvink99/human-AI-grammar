# Line chart with one tick label per day
import matplotlib.pyplot as plt
import numpy as np
days = [f"2024-03-{d:02d}" for d in range(1, 31)]
vals = np.cumsum(np.random.default_rng(3).normal(size=30))
fig, ax = plt.subplots(figsize=(6, 3.5))
ax.plot(days, vals)
ax.set_xticks(range(30))
ax.set_xticklabels(days)
ax.set_title("Daily index value")
ax.set_xlabel("Date")
ax.set_ylabel("Index")
