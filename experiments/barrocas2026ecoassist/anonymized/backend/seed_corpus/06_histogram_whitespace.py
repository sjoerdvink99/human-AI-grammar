# Histogram on an oversized canvas with no labels
import matplotlib.pyplot as plt
import numpy as np
data = np.random.default_rng(7).normal(170, 8, 500)
fig = plt.figure(figsize=(9, 6))
ax = fig.add_axes([0.35, 0.35, 0.3, 0.3])
ax.hist(data, bins=20, color="gray")
