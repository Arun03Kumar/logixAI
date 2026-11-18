"""
Synthetic datasets for ML Arena dataset challenges. Seeded, so re-running
gives identical files. Usage (from apps/arena-service):

    docker run --rm -i logixai/python-ml:1 python3 - loans  < scripts/datasets/make_datasets.py > content/datasets/loans.csv
    docker run --rm -i logixai/python-ml:1 python3 - houses < scripts/datasets/make_datasets.py > content/datasets/houses.csv

The data is made up but shaped like the real thing: skewed incomes, missing
values, categorical columns, class imbalance and noise.
"""
import sys

import numpy as np
import pandas as pd


def loans(rng):
    n = 900
    age = rng.integers(21, 66, n).astype(float)
    employment = rng.choice(["salaried", "self_employed", "unemployed"], n, p=[0.62, 0.30, 0.08])
    income = np.round(rng.lognormal(mean=3.6, sigma=0.55, size=n), 1)  # thousand rupees / month
    income[employment == "unemployed"] = np.round(income[employment == "unemployed"] * 0.25, 1)
    credit_score = np.clip(rng.normal(690, 70, n), 300, 900).round()
    loan_amount = np.round(rng.lognormal(mean=5.6, sigma=0.6, size=n), 0)  # thousand rupees
    term_months = rng.choice([12, 24, 36, 60], n, p=[0.15, 0.3, 0.35, 0.2])
    past_defaults = rng.choice([0, 1, 2, 3], n, p=[0.72, 0.18, 0.07, 0.03])
    emi_ratio = (loan_amount / term_months) / np.maximum(income, 1)

    z = (
        -3.0
        + 2.2 * np.clip(emi_ratio, 0, 3)
        - 0.012 * (credit_score - 690)
        + 0.9 * past_defaults
        + np.where(employment == "unemployed", 1.4, np.where(employment == "self_employed", 0.35, 0))
        - 0.01 * (age - 40)
        + rng.normal(0, 0.6, n)
    )
    default = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)

    df = pd.DataFrame(
        {
            "age": age,
            "employment": employment,
            "monthly_income_k": income,
            "credit_score": credit_score,
            "loan_amount_k": loan_amount,
            "term_months": term_months,
            "past_defaults": past_defaults,
            "default": default,
        }
    )
    # Real application data has gaps.
    df.loc[rng.random(n) < 0.06, "monthly_income_k"] = np.nan
    df.loc[rng.random(n) < 0.04, "age"] = np.nan
    df.loc[rng.random(n) < 0.05, "credit_score"] = np.nan
    return df


def houses(rng):
    n = 800
    cities = np.array(["Mumbai", "Bengaluru", "Pune", "Delhi", "Hyderabad", "Jaipur"])
    city = rng.choice(cities, n, p=[0.18, 0.22, 0.17, 0.18, 0.15, 0.10])
    price_per_sqft = {"Mumbai": 21000, "Bengaluru": 9000, "Pune": 8000, "Delhi": 11000, "Hyderabad": 7000, "Jaipur": 5000}
    bedrooms = rng.choice([1, 2, 3, 4], n, p=[0.2, 0.42, 0.3, 0.08])
    area = np.round(bedrooms * 380 + rng.normal(160, 140, n)).clip(300, 3500)
    bathrooms = np.clip(bedrooms - rng.choice([0, 1], n, p=[0.6, 0.4]) + rng.choice([0, 1], n, p=[0.8, 0.2]), 1, 4)
    age_years = rng.integers(0, 35, n)
    distance_km = np.round(rng.gamma(2.0, 5.0, n), 1)
    parking = (rng.random(n) < 0.55).astype(int)

    base = np.array([price_per_sqft[c] for c in city]) * area
    price = (
        base
        * (1 - 0.007 * age_years)
        * np.exp(-0.018 * distance_km)
        * (1 + 0.06 * parking)
        * np.exp(rng.normal(0, 0.12, n))
    )
    df = pd.DataFrame(
        {
            "city": city,
            "area_sqft": area,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "age_years": age_years,
            "distance_km": distance_km,
            "parking": parking,
            "price_lakh": np.round(price / 100000, 2),
        }
    )
    df.loc[rng.random(n) < 0.04, "age_years"] = np.nan
    return df


MAKERS = {"loans": loans, "houses": houses}

if __name__ == "__main__":
    name = sys.argv[1]
    df = MAKERS[name](np.random.default_rng({"loans": 2026, "houses": 1729}[name]))
    sys.stdout.write(df.to_csv(index=False, lineterminator="\n"))
