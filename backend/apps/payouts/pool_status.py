"""Public administrative status of the currently blocked settlement path."""


def subscription_pool_status():
    return {
        "pool_settlement_status": "blocked",
        "pool_settlement_reason": (
            "New subscription pool settlements are blocked pending F03/C06 approval "
            "and verified historical paid learning time without duplicate credit. "
            "The configured pool rate and historical earnings are preserved."
        ),
    }
