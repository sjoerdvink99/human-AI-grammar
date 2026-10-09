# Grid of subplots whose titles and labels collide
import matplotlib.pyplot as plt
import numpy as np
fig, axes = plt.subplots(2, 3, figsize=(6, 4))
x = np.linspace(0, 10, 50)
for i, ax in enumerate(axes.flat):
    ax.plot(x, np.sin(x * (i + 1)))
    ax.set_title(f"Frequency response {i + 1}")
    ax.set_xlabel("Time (seconds)")
    ax.set_ylabel("Amplitude (V)")
