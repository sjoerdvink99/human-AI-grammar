# Scatter clusters with a large legend in the middle
import matplotlib.pyplot as plt
import numpy as np
rng = np.random.default_rng(11)
fig, ax = plt.subplots(figsize=(5, 4))
for k, (cx, cy) in enumerate([(0, 0), (3, 3), (0, 3), (3, 0), (1.5, 1.5)]):
    ax.scatter(cx + rng.normal(size=40) * 0.6, cy + rng.normal(size=40) * 0.6, label=f"Cluster {k + 1}")
ax.legend(loc="center", fontsize=11)
ax.set_title("Customer segments")
ax.set_xlabel("Spend")
ax.set_ylabel("Visits")
