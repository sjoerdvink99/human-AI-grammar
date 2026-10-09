# Scatter plot with tiny fonts and no axis labels
import matplotlib.pyplot as plt
import numpy as np
rng = np.random.default_rng(1)
x = rng.normal(size=120)
y = 2 * x + rng.normal(size=120)
fig, ax = plt.subplots(figsize=(5, 4))
ax.scatter(x, y, s=12, alpha=0.7)
ax.tick_params(labelsize=5)
ax.set_title("Height vs weight", fontsize=6)
