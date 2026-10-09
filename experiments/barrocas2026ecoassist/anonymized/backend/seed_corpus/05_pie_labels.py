# Pie chart with many small crowded slices
import matplotlib.pyplot as plt
labels = ["Rent", "Groceries", "Transport", "Utilities", "Insurance", "Phone", "Internet",
          "Streaming", "Gym", "Coffee", "Books", "Gifts"]
sizes = [40, 15, 10, 6, 5, 3, 3, 2, 2, 1.5, 1.2, 1.0]
fig, ax = plt.subplots(figsize=(4, 4))
ax.pie(sizes, labels=labels)
ax.set_title("Monthly budget")
